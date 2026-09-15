import { Template } from "e2b";

export const TEMPLATE_ALIAS = "tailcat";
export const TAILCAT_VERSION = "0.6.0";
export const TAILCAT_URL = `https://github.com/tailscale/tailcat/releases/download/v${TAILCAT_VERSION}/tailcat_${TAILCAT_VERSION}_linux_amd64.tar.gz`;

export const tailcatTemplate = Template()
  .fromImage("ubuntu:24.04")
  .setEnvs({ DEBIAN_FRONTEND: "noninteractive" })
  // openssh-client: `tailcat cp` and `tailcat ssh` drive the system scp/ssh.
  // socat: turns a tailcat stdio pipe into a local TCP port (sandbox-tests-local-dev-server).
  // python3: pretty-prints the JSON report in sandbox-to-sandbox.
  .aptInstall(["curl", "ca-certificates", "openssh-client", "socat", "python3"])
  .runCmd(
    `curl -fsSL -o /tmp/tailcat.tgz ${TAILCAT_URL}` +
      " && mkdir -p /tmp/tc && tar xzf /tmp/tailcat.tgz -C /tmp/tc" +
      " && install -m 0755 $(find /tmp/tc -type f -name tailcat) /usr/local/bin/tailcat" +
      " && rm -rf /tmp/tc /tmp/tailcat.tgz && tailcat version",
    { user: "root" },
  )
  .setUser("user")
  .setWorkdir("/home/user");
