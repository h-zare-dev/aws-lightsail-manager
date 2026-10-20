#!/bin/bash
# Example *cloud-init user data* (runs as root at first boot only).
set -euxo pipefail
apt-get update
apt-get install -y curl ca-certificates
