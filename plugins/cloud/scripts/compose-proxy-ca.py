import json
import sys
from pathlib import Path
from string import Template

# 起動後のコンテナも外部の HTTPS に繋げるよう、プロキシの CA を渡す。secret は /run/secrets に置かれる
CA = "/run/secrets/ca-certificates"
RUNTIME = {
    "secrets": ["ca-certificates"],
    "environment": {
        "SSL_CERT_FILE": CA,
        "NODE_EXTRA_CA_CERTS": CA,
        "REQUESTS_CA_BUNDLE": CA,
    },
}
BUILD = {"build": {"secrets": ["ca-certificates"]}}

services = json.load(sys.stdin)["services"]
overrides = {
    name: RUNTIME | (BUILD if "build" in service else {})
    for name, service in services.items()
}
template = Path(__file__).parent / "session" / "compose.proxy-ca.yaml"
sys.stdout.write(
    Template(template.read_text()).substitute(services=json.dumps(overrides))
)
