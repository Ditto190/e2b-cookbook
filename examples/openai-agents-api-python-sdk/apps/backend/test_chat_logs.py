import unittest

from chat_logs import ChatLog, SecretStreamRedactor


class ChatLogTest(unittest.TestCase):
    def test_cursor_reads_after_eviction_clear_and_close(self):
        log = ChatLog(max_records=3)
        for i in range(5):
            log.publish_message(str(i))
        read = log.wait_after(0, timeout=0)
        self.assertEqual([r.seq for r in read.records], [3, 4, 5])
        self.assertEqual(read.gap_through, 2)
        self.assertEqual([r.seq for r in log.wait_after(4, timeout=0).records], [5])
        self.assertEqual(log.wait_after(5, timeout=0).records, ())
        log.clear()
        self.assertEqual(log.wait_after(0, timeout=0).gap_through, 5)
        log.publish_message("new")
        log.close("reset")
        read = log.wait_after(5, timeout=0)
        self.assertEqual([r.seq for r in read.records], [6])
        self.assertEqual(read.closed_reason, "reset")

    def test_recent_text_matches_filtered_history_suffix(self):
        log = ChatLog()
        lines = ["first", "", "hello 🦊", "last"]
        for line in lines:
            log.publish_message(line + "\n")
            log.publish_message("other stream", stream="stdout")
        for limit in range(1, 40):
            self.assertEqual(
                log.recent_text(source="backend", stream="stderr", limit=limit),
                "\n".join(lines)[-limit:],
            )

    def test_redaction_at_every_chunk_boundary(self):
        text = "start\nsecret-one and secret-two\nend"
        for split in range(len(text) + 1):
            redactor = SecretStreamRedactor("secret-one", "secret-two")
            result = redactor.feed(text[:split]) + redactor.feed(text[split:])
            result += redactor.finish()
            self.assertEqual(result, "start\n[redacted] and [redacted]\nend")
