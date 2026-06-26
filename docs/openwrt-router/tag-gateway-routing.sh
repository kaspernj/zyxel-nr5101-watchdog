#!/bin/sh

. /lib/functions.sh

LAN_DEVICE="${LAN_DEVICE:-br-lan.86}"
O2_TAG="o2gateway"
O2_GATEWAY="192.168.86.1"
O2_TABLE="101"
TELEKOM_TAG="telekomgateway"
TELEKOM_GATEWAY="192.168.86.3"
TELEKOM_TABLE="103"
BASE_PRIORITY="10000"

priority="$BASE_PRIORITY"
errors=0
rule_count=0

log_info() {
  logger -t tag-gateway-routing "$1"
}

route_table_name() {
  case "$1" in
    "$O2_TABLE") printf "%s" "$O2_TAG" ;;
    "$TELEKOM_TABLE") printf "%s" "$TELEKOM_TAG" ;;
    *) printf "%s" "$1" ;;
  esac
}

disable_redirects() {
  local path

  for path in /proc/sys/net/ipv4/conf/*/send_redirects; do
    [ -e "$path" ] && printf "0\n" > "$path"
  done
}

clear_table() {
  local table="$1"

  while ip -4 rule del lookup "$table" 2>/dev/null; do
    true
  done

  ip -4 route flush table "$table" 2>/dev/null || true
}

copy_connected_routes() {
  local table="$1"

  ip -4 route show table main | while IFS= read -r route; do
    case "$route" in
      default*|*" wg0_pia"*) continue ;;
      192.168.*" scope link"*|192.168.*" src "*) ip -4 route replace table "$table" $route ;;
    esac
  done
}

setup_table() {
  local table="$1"
  local gateway="$2"

  clear_table "$table"
  copy_connected_routes "$table"

  if ! ip -4 route replace table "$table" default via "$gateway" dev "$LAN_DEVICE"; then
    log_info "failed to install default route via $gateway in table $(route_table_name "$table")"
    errors=1
  fi
}

has_tag() {
  local wanted_tag="$1"
  local host_tag
  shift

  for host_tag in "$@"; do
    [ "$host_tag" = "$wanted_tag" ] && return 0
  done

  return 1
}

add_host_rule() {
  local cfg="$1"
  local ip name tags target_count table tag

  config_get ip "$cfg" ip
  config_get name "$cfg" name "$cfg"
  config_get tags "$cfg" tag

  [ -n "$ip" ] || return 0

  target_count=0
  table=""

  if has_tag "$O2_TAG" $tags; then
    target_count=$((target_count + 1))
    table="$O2_TABLE"
    tag="$O2_TAG"
  fi

  if has_tag "$TELEKOM_TAG" $tags; then
    target_count=$((target_count + 1))
    table="$TELEKOM_TABLE"
    tag="$TELEKOM_TAG"
  fi

  [ "$target_count" -eq 0 ] && return 0

  if [ "$target_count" -gt 1 ]; then
    log_info "host $name ($ip) has both gateway tags; not installing a routing rule"
    errors=1
    return 0
  fi

  priority=$((priority + 1))

  if ip -4 rule add priority "$priority" iif "$LAN_DEVICE" from "$ip/32" lookup "$table"; then
    rule_count=$((rule_count + 1))
  else
    log_info "failed to install rule for $name ($ip) tagged $tag"
    errors=1
  fi
}

apply_rules() {
  disable_redirects
  setup_table "$O2_TABLE" "$O2_GATEWAY"
  setup_table "$TELEKOM_TABLE" "$TELEKOM_GATEWAY"

  config_load dhcp
  config_foreach add_host_rule host

  if [ "$errors" -ne 0 ]; then
    log_info "completed with errors after installing $rule_count routing rules"
    return 1
  fi

  log_info "installed $rule_count tag-based gateway routing rules"
}

case "${1:-apply}" in
  apply) apply_rules ;;
  *) printf "Usage: %s apply\n" "$0" >&2; exit 2 ;;
esac
