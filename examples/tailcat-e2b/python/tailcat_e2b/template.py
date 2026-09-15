from e2b import Template

TEMPLATE_ALIAS = "tailcat"
TAILCAT_VERSION = "0.6.0"
TAILCAT_URL = (
    "https://github.com/tailscale/tailcat/releases/download/"
    f"v{TAILCAT_VERSION}/tailcat_{TAILCAT_VERSION}_linux_amd64.tar.gz"
)

tailcat_template = (
    Template()
    .from_image("ubuntu:24.04")
    .set_envs({"DEBIAN_FRONTEND": "noninteractive"})
    # openssh-client: `tailcat cp` and `tailcat ssh` drive the system scp/ssh.
    # socat: turns a tailcat stdio pipe into a local TCP port (sandbox-tests-local-dev-server).
    # python3: pretty-prints the JSON report in sandbox-to-sandbox.
    .apt_install(["curl", "ca-certificates", "openssh-client", "socat", "python3"])
    .run_cmd(
        f"curl -fsSL -o /tmp/tailcat.tgz {TAILCAT_URL}"
        " && mkdir -p /tmp/tc && tar xzf /tmp/tailcat.tgz -C /tmp/tc"
        " && install -m 0755 $(find /tmp/tc -type f -name tailcat) /usr/local/bin/tailcat"
        " && rm -rf /tmp/tc /tmp/tailcat.tgz && tailcat version",
        user="root",
    )
    .set_user("user")
    .set_workdir("/home/user")
)
