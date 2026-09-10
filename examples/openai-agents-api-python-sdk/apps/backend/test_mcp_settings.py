"""Credential boundaries and transactional changes to an existing chat."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app


class McpSettingsTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(app.auth, 'auth_enabled', return_value=False))
        self.enterContext(patch.object(app, 'mcp_credentials', {}))
        self.enterContext(patch.object(app, 'sessions', {}))
        self.enterContext(patch.object(app, 'chat_records', {}))
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.object(app, 'STATE_FILE', Path(directory) / 'state.json'))
        self.client = app.app.test_client()

    def save(self, options):
        return self.client.post('/api/mcp/credentials', json={'server': 'exa', 'options': options})

    def test_credentials_are_masked_reusable_and_not_persisted(self):
        self.assertEqual(self.save({}).status_code, 400)
        self.assertEqual(self.save({'apiKey': 'test-secret', 'unknown': 'bad'}).status_code, 400)
        response = self.save({'apiKey': 'test-secret'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'options': {'exa': {'apiKey': '•'}}})
        self.assertNotIn('test-secret', self.client.get('/api/mcp/credentials').text)
        self.assertEqual(self.save({'apiKey': ''}).status_code, 200)
        mcp = app.McpCapability(servers=['exa'])
        app.resolve_mcp_options(mcp)
        self.assertEqual(mcp.options, {'exa': {'apiKey': 'test-secret'}})
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key', session_id='sess-test')
        demo.capabilities.mcp = mcp
        app.save_chat_record(demo)
        self.assertNotIn('test-secret', app.STATE_FILE.read_text())
        self.assertEqual(app.chat_records['chat-test']['capabilities']['mcp']['options'], {'exa': {'apiKey': '•'}})

    def test_invalid_credentials_and_unauthenticated_access_are_refused(self):
        for server in ([], {}, 'missing'):
            self.assertEqual(self.client.post('/api/mcp/credentials', json={'server': server}).status_code, 400)
        with patch.object(app.auth, 'auth_enabled', return_value=True):
            self.assertEqual(self.client.get('/api/mcp/credentials').status_code, 401)
            self.assertEqual(self.save({'apiKey': 'test-secret'}).status_code, 401)
            self.assertEqual(self.client.post('/api/mcp/selection', json={}).status_code, 401)

    def test_blank_fields_keep_credentials_already_attached_to_the_chat(self):
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key')
        demo.capabilities.mcp = app.McpCapability(servers=['exa'], options={'exa': {'apiKey': 'existing-key'}})
        app.sessions[demo.chat_id] = demo
        response = self.client.post('/api/mcp/credentials', json={
            'chat_id': demo.chat_id, 'server': 'exa', 'options': {}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'options': {'exa': {'apiKey': '•'}}})
        self.assertEqual(app.mcp_credentials['exa']['apiKey'], 'existing-key')

    def test_rotated_credentials_apply_only_when_selection_is_saved(self):
        self.save({'apiKey': 'new-key'})
        previous = app.McpCapability(servers=['exa'], options={'exa': {'apiKey': 'old-key'}})
        app.resolve_mcp_options(previous)
        self.assertEqual(previous.options['exa']['apiKey'], 'old-key')
        next_mcp = app.McpCapability(servers=['exa'])
        app.resolve_mcp_options(next_mcp, previous, prefer_saved=True)
        self.assertEqual(next_mcp.options['exa']['apiKey'], 'new-key')

    def test_busy_chat_is_not_mutated_and_noop_does_not_reconnect(self):
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key', session_id='sess-test')
        demo.capabilities.mcp = app.McpCapability(servers=['openai_docs'])
        app.sessions[demo.chat_id] = demo
        body = {'chat_id': demo.chat_id, 'client_id': demo.client_id, 'mcp': {'servers': ['fetch']}}
        demo.turn_lock.acquire()
        with patch.object(app, 'queue_mcp_selection', new=AsyncMock()) as queue:
            self.assertEqual(self.client.post('/api/mcp/selection', json=body).status_code, 202)
            queue.assert_awaited_once()
            self.assertEqual(queue.call_args.args[1].servers, ['fetch'])
        self.assertEqual(demo.capabilities.mcp.servers, ['openai_docs'])
        demo.turn_lock.release()
        body['mcp'] = {'servers': ['openai_docs']}
        with patch.object(app, 'reconfigure_mcp') as reconfigure:
            self.assertEqual(self.client.post('/api/mcp/selection', json=body).status_code, 200)
            reconfigure.assert_not_called()
        self.assertFalse(demo.turn_lock.locked())

    def test_missing_credentials_release_the_turn_lock(self):
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key', session_id='sess-test')
        app.sessions[demo.chat_id] = demo
        response = self.client.post('/api/mcp/selection', json={
            'chat_id': demo.chat_id, 'client_id': demo.client_id, 'mcp': {'servers': ['exa']}})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(demo.turn_lock.locked())

    def test_next_prompt_waits_for_a_saved_mcp_update(self):
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key', session_id='sess-test')
        demo.pending_mcp = app.McpCapability(servers=['fetch'])
        app.sessions[demo.chat_id] = demo
        with patch.object(app.chat_history, 'begin') as begin:
            response = self.client.post('/api/chat', json={
                'chat_id': demo.chat_id, 'client_id': demo.client_id, 'prompt': 'Use Fetch'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['code'], 'turn_running')
        begin.assert_not_called()
        self.assertFalse(demo.turn_lock.locked())


class McpReconnectionTest(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, fail=False, legacy=False):
        sandbox = SimpleNamespace(sandbox_id='same-sandbox')
        demo = app.DemoSession(chat_id='chat-test', client_id='client-test', api_key='key',
                               session_id='old-session', environment_id='old-env', sandbox=sandbox,
                               sandbox_id='same-sandbox')
        if legacy:
            demo.capabilities.mcp = app.McpCapability(servers=['context7'])
        demo.turn_lock.acquire()
        demo.seen_turn_ids.add('old-turn')
        sdk = SimpleNamespace(sessions=SimpleNamespace(
            retrieve=AsyncMock(return_value=SimpleNamespace(info=SimpleNamespace(agent={
                'tools': [{'type': 'mcp', 'server_label': 'context7'}]}))),
            create=AsyncMock(return_value=SimpleNamespace(id='new-session')),
            delete=AsyncMock()), aclose=AsyncMock())
        launches = []

        async def launch(current, handle):
            launches.append((current.session_id, handle))
            if fail and len(launches) == 1:
                raise RuntimeError('gateway failed')

        with patch.object(app, 'AgentAPISDK', return_value=sdk), \
             patch.object(app, 'ensure_executor', new=AsyncMock()), \
             patch.object(app, 'session_environment_id', return_value='new-env'), \
             patch.object(app, 'render_parent_transcript', new=AsyncMock(return_value=' recent conversation')), \
             patch.object(app, 'launch_exec_server', side_effect=launch), \
             patch.object(app, 'sync_executor_history', new=AsyncMock()), \
             patch.object(app, 'save_chat_record'):
            mcp = app.McpCapability(servers=['context7'] if legacy else ['fetch'])
            if fail:
                with self.assertRaisesRegex(RuntimeError, 'gateway failed'):
                    await app.reconfigure_mcp(demo, mcp)
                self.assertEqual((demo.session_id, demo.environment_id), ('old-session', 'old-env'))
                self.assertEqual(demo.capabilities.mcp.servers, ['hackernews', 'context7', 'deepwiki', 'openai_docs'])
                self.assertEqual(launches, [('new-session', sandbox), ('old-session', sandbox)])
                sdk.sessions.delete.assert_awaited_once_with('new-session')
                self.assertEqual(demo.seen_turn_ids, {'old-turn'})
            else:
                await app.reconfigure_mcp(demo, mcp)
                self.assertEqual((demo.session_id, demo.environment_id), ('new-session', 'new-env'))
                self.assertEqual(demo.capabilities.mcp.servers, mcp.servers)
                self.assertEqual(launches, [('new-session', sandbox)])
                sdk.sessions.delete.assert_awaited_once_with('old-session')
                self.assertFalse(demo.seen_turn_ids)
                self.assertIn('recent conversation', sdk.sessions.create.call_args.kwargs['agent']['instructions'])
            self.assertEqual(demo.sandbox_id, 'same-sandbox')
            self.assertFalse(demo.turn_lock.locked())

    async def test_reconnect_preserves_workspace_and_chat_context(self):
        await self.scenario()

    async def test_unchanged_context7_selection_migrates_a_legacy_direct_session(self):
        await self.scenario(legacy=True)

    async def test_failed_reconnect_restores_the_previous_session(self):
        await self.scenario(fail=True)


class GatewayCatalogCompatibilityTest(unittest.TestCase):
    def test_context7_omits_only_the_unresolved_credential_header(self):
        from mcp_gateway_compat import update_catalog
        source = '''registry:
  context7:
    remote:
      url: https://mcp.context7.com/mcp
      headers:
        CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}"
    prompts: 0
  other:
    remote:
      headers:
        CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}"
'''
        result = update_catalog(source)
        self.assertEqual(result.count('${CONTEXT7_API_KEY}'), 1)
        self.assertIn('url: https://mcp.context7.com/mcp\n    prompts: 0', result)
        self.assertEqual(update_catalog(result), result)
        configured = source.replace('${CONTEXT7_API_KEY}', 'configured-key')
        self.assertEqual(update_catalog(configured), configured)

    def test_only_the_obsolete_deepwiki_entry_is_repaired(self):
        from mcp_gateway_compat import update_catalog
        source = """registry:
  other:
    remote:
      transport_type: sse
      url: https://other.example/sse
  deepwiki:
    remote:
      transport_type: sse
      url: https://mcp.deepwiki.com/sse
  another:
    remote:
      transport_type: sse
"""
        result = update_catalog(source)
        self.assertIn('transport_type: streamable-http', result)
        self.assertIn('url: https://mcp.deepwiki.com/mcp', result)
        self.assertEqual(result.count('transport_type: sse'), 2)
        self.assertEqual(update_catalog(result), result)
        self.assertEqual(update_catalog('registry: {}'), 'registry: {}')


class PendingMcpSelectionTest(unittest.IsolatedAsyncioTestCase):
    async def test_latest_save_waits_for_turn_and_applies_without_changing_active_tools(self):
        demo = app.DemoSession(chat_id='pending-chat', client_id='client-test', api_key='key')
        old_mcp = demo.capabilities.mcp.model_copy(deep=True)
        applied = []
        async def reconfigure(current, selected):
            applied.append(selected.servers)
            current.capabilities.mcp = selected
            current.turn_lock.release()
        with patch.object(app, 'sessions', {demo.chat_id: demo}), \
             patch.object(app, 'reconfigure_mcp', side_effect=reconfigure):
            demo.turn_lock.acquire()
            await app.queue_mcp_selection(demo, app.McpCapability(servers=['fetch']))
            await asyncio.sleep(0)
            await app.queue_mcp_selection(demo, app.McpCapability(servers=[]))
            task = demo.mcp_update_task
            self.assertEqual(demo.capabilities.mcp, old_mcp)
            self.assertEqual(applied, [])
            self.assertEqual(app.session_snapshot(demo)['pending_mcp']['servers'], [])
            demo.turn_lock.release()
            await asyncio.wait_for(task, 1)
        self.assertEqual(applied, [[]])
        self.assertEqual(demo.capabilities.mcp.servers, [])
        self.assertIsNone(demo.pending_mcp)
        self.assertIsNone(demo.mcp_update_task)

    async def test_a_save_during_reconnect_is_applied_next_and_errors_are_not_exposed(self):
        demo = app.DemoSession(chat_id='pending-chat', client_id='client-test', api_key='key')
        old_mcp = demo.capabilities.mcp.model_copy(deep=True)
        started, finish = asyncio.Event(), asyncio.Event()
        applied = []
        async def reconfigure(current, selected):
            applied.append(selected.servers)
            try:
                if len(applied) == 1:
                    started.set()
                    await finish.wait()
                    raise RuntimeError('private-credential-value')
                current.capabilities.mcp = selected
            finally:
                current.turn_lock.release()
        with patch.object(app, 'sessions', {demo.chat_id: demo}), \
             patch.object(app, 'reconfigure_mcp', side_effect=reconfigure):
            await app.queue_mcp_selection(demo, app.McpCapability(servers=['fetch']))
            await asyncio.wait_for(started.wait(), 1)
            self.assertEqual(demo.capabilities.mcp, old_mcp)
            await app.queue_mcp_selection(demo, app.McpCapability(servers=['hackernews']))
            task = demo.mcp_update_task
            finish.set()
            await asyncio.wait_for(task, 1)
        self.assertEqual(applied, [['fetch'], ['hackernews']])
        self.assertEqual(demo.capabilities.mcp.servers, ['hackernews'])
        self.assertIsNone(demo.mcp_update_error)
        self.assertFalse(demo.turn_lock.locked())

    async def test_failed_update_keeps_old_selection_and_exposes_a_safe_retry_message(self):
        demo = app.DemoSession(chat_id='pending-chat', client_id='client-test', api_key='key')
        old_mcp = demo.capabilities.mcp.model_copy(deep=True)
        async def reconfigure(current, selected):
            current.turn_lock.release()
            raise RuntimeError('private-credential-value')
        with patch.object(app, 'sessions', {demo.chat_id: demo}), \
             patch.object(app, 'reconfigure_mcp', side_effect=reconfigure):
            await app.queue_mcp_selection(demo, app.McpCapability(servers=['fetch']))
            await asyncio.wait_for(demo.mcp_update_task, 1)
        self.assertEqual(demo.capabilities.mcp, old_mcp)
        self.assertIn('Open MCPs to retry', demo.mcp_update_error)
        self.assertNotIn('private-credential-value', str(app.session_snapshot(demo)))
        self.assertIsNone(demo.pending_mcp)

    async def test_reset_discards_queued_changes_without_resurrecting_the_chat(self):
        demo = app.DemoSession(chat_id='pending-chat', client_id='client-test', api_key='key')
        with patch.object(app, 'sessions', {}), \
             patch.object(app, 'reconfigure_mcp', new=AsyncMock()) as reconfigure:
            await app.queue_mcp_selection(demo, app.McpCapability(servers=[]))
            await asyncio.wait_for(demo.mcp_update_task, 1)
            reconfigure.assert_not_called()
        self.assertIsNone(demo.pending_mcp)
