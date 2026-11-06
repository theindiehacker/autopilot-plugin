import json
import sys

services = json.load(sys.stdin)["services"]
json.dump(
    {
        "secrets": {"ca-certificates": {"file": ".claude/session/proxy-ca.crt"}},
        "services": {
            name: {"build": {"secrets": ["ca-certificates"]}}
            for name, service in services.items()
            if "build" in service
        },
    },
    sys.stdout,
)
