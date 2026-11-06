import json
import sys
from pathlib import Path
from string import Template

services = json.load(sys.stdin)["services"]
builds = {
    name: {"build": {"secrets": ["ca-certificates"]}}
    for name, service in services.items()
    if "build" in service
}
template = Path(__file__).parent / "compose.override.yml"
sys.stdout.write(Template(template.read_text()).substitute(services=json.dumps(builds)))
