---
title: "Sandbox Security"
slug: securing-your-sandbox
order: 6
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/securing-your-sandbox
---

# Sandbox Security

Agents can perform a wide range of actions within a sandbox, including generating and executing code. Because sandboxes may operate within your network and access your data or your users’ data, we recommend the following security practices.

## 1\. Sandbox isolation

Run workloads in isolated environments, such as virtual machines or Firecracker microVMs. Use separate sandboxes for users or workloads that should not share data.

## 2\. Control network ingress and egress

Restrict outbound traffic to approved endpoints to prevent untrusted code from accessing unauthorized systems or sending data to external hosts.

At a minimum, Agents API environments require access to:

- `https://api.openai.com`
- `wss://codex-cloud-environments.chatgpt.com`

Additional access should reflect where your tools run. Public HTTP MCP servers can be connected on the agent side or explicitly allowed from the sandbox when necessary. Private MCP servers can remain within your network and connect through executor MCPs.

## 3\. Scope your OpenAI API credentials

Create a dedicated OpenAI project for your application or workload. Create a separate restricted executor key for the same organization, project, and user or service account that owns the session. Set **List models → Read** and set every other permission to **None**.

The executor does not need a customer-visible endpoint permission to register. The dashboard requires at least one selected permission for a restricted key, so choose **List models → Read**. It provides model metadata but does not allow model inference, Responses, Files, or write access. An empty permission list is unrestricted.

Grant the application API key **Responses (/v1/responses) → Write** to run model inference and session operations. When available, add **Managed Agents → Write**, which grants `api.agents.read` and `api.agents.write`, when your application manages vaults. Keep the broader application key outside the sandbox.

Pass only the restricted executor key to the sandbox as `CODEX_API_KEY`. Agent-generated commands inherit the executor process environment and can read this key. The key is not protected from sandbox code. Treat it as exposed to untrusted code, isolate workloads and projects, and rotate or revoke it when necessary.

You can provide the executor credential using either of the following options:

**Restricted project API key.** Create the key for the same organization, project, and user or service account that owns the session, grant **List models → Read**, set every other permission to **None**, and provide it as `CODEX_API_KEY` alongside the assigned environment ID.

**Workload identity federation.** Configure your cloud provider or cluster as an OpenAI workload identity provider, and map the workload to a service account in the same OpenAI project. Use the same service-account identity to create the session and authenticate the executor. Exchange the workload identity for a short-lived OpenAI access token using the token exchange endpoint. The short-lived token is also visible to agent-generated code; scope it minimally and refresh it before expiry.

## 4\. Credential handling and brokering

Keep broader application API keys and third-party credentials outside the sandbox. Do not embed secrets in sandbox images or store them in the workspace. The restricted executor key is the exception: it must be available as `CODEX_API_KEY`, and agent-generated code can read it.

Where possible, use a credential broker that keeps secrets outside the sandbox and injects them into approved outbound requests through a proxy. For example, Vercel Sandbox supports outbound header injection, while AWS Lambda MicroVMs support VPC egress network connectors.

![An agent runs sandbox tools through a credential proxy that injects scoped secrets before requests reach an external API.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/sandbox-security-1.webp)

Alternatively, store long-lived credentials in a secrets manager, rotate them regularly, and revoke them immediately if exposure is suspected.
