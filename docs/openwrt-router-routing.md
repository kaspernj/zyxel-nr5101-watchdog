# OpenWrt Router Routing

This documents the local OpenWrt router at `192.168.86.7` (`GoogleWifi-7`). It is an operational note for the home network, not application runtime configuration.

## Role

The router is the DHCP gateway for selected `192.168.86.0/24` clients. It also has a WireGuard client interface, so its normal default route is the VPN. Static DHCP tags decide which tagged clients should bypass that VPN and leave through one of the upstream gateway routers instead.

## Interfaces

- `br-lan.86`: `192.168.86.7/24`, main LAN where the tagged clients live.
- `br-lan.87`: `192.168.87.7/24`, local VLAN/subnet.
- `br-lan.88`: `192.168.88.7/24`, local VLAN/subnet.
- `wg0_pia`: WireGuard VPN client; default route for traffic that is not matched by the tag-based bypass rules.

## Gateway Tags

The source of truth for bypass groups is `/etc/config/dhcp` static host tags:

- `o2gateway`: hosts in this tag route through upstream gateway `192.168.86.1`.
- `telekomgateway`: hosts in this tag route through upstream gateway `192.168.86.3`.
- `vpngateway`: hosts in this tag use `192.168.86.7` as their DHCP gateway and then follow the router's normal VPN default route.

The DHCP tag sections currently advertise `192.168.86.7` as the client default gateway:

```text
dhcp.o2gateway.dhcp_option='3,192.168.86.7'
dhcp.telekomgateway.dhcp_option='3,192.168.86.7'
dhcp.vpngateway.dhcp_option='3,192.168.86.7'
dhcp.lan.dhcp_option='3,192.168.86.7'
```

Do not change `o2gateway` or `telekomgateway` back to advertising `.1` or `.3` directly. Clients must send traffic to `.7` first so `.7` can apply the source-based routing rules.

## Routing Tables

The router uses two extra IPv4 policy routing tables:

- Table `101`: default route via `192.168.86.1` on `br-lan.86` for `o2gateway` hosts.
- Table `103`: default route via `192.168.86.3` on `br-lan.86` for `telekomgateway` hosts.

Each table also includes the local connected routes for `192.168.86.0/24`, `192.168.87.0/24`, and `192.168.88.0/24`. That keeps local traffic local instead of sending it to an upstream gateway.

Rules are generated as source-IP rules scoped to the incoming LAN interface:

```text
from <static-host-ip>/32 iif br-lan.86 lookup 101
from <static-host-ip>/32 iif br-lan.86 lookup 103
```

The `iif br-lan.86` scope keeps these rules from matching traffic that merely spoofs a tagged source IP on another interface.

## Installed Files

The custom routing setup is implemented by these files on `192.168.86.7`:

- `/usr/local/sbin/tag-gateway-routing`: reads `/etc/config/dhcp`, builds routing tables `101` and `103`, and installs one rule per static host tagged `o2gateway` or `telekomgateway`. The installed helper is mirrored in this repo at [`docs/openwrt-router/tag-gateway-routing.sh`](openwrt-router/tag-gateway-routing.sh).
- `/etc/init.d/tag-gateway-routing`: enabled init service that applies the rules at boot.
- `/etc/hotplug.d/iface/95-tag-gateway-routing`: reapplies the rules after interface `ifup` or `ifupdate` events.
- `/etc/sysctl.d/99-disable-ipv4-redirects.conf`: persists disabled IPv4 ICMP redirects.

The helper intentionally skips a host with both `o2gateway` and `telekomgateway` tags instead of guessing which gateway should win.

## ICMP Redirects

This is same-LAN forwarding: clients send to `.7`, then `.7` forwards back out `br-lan.86` to `.1` or `.3`. Linux routers can send ICMP redirects in that topology, telling clients to bypass `.7`.

Redirects are disabled with:

```text
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
```

The helper also writes `0` to existing `/proc/sys/net/ipv4/conf/*/send_redirects` entries every time it applies rules, including `br-lan.86`.

## Validation

Use these commands on `192.168.86.7`.

Check DHCP tag options:

```sh
uci show dhcp.o2gateway
uci show dhcp.telekomgateway
uci show dhcp.vpngateway
uci show dhcp.lan.dhcp_option
```

Check routes and rules:

```sh
ip -4 route show table 101
ip -4 route show table 103
ip -4 rule show
```

Check sample route decisions:

```sh
ip -4 route get 1.1.1.1 from 192.168.86.30 iif br-lan.86
ip -4 route get 1.1.1.1 from 192.168.86.31 iif br-lan.86
ip -4 route get 1.1.1.1 from 192.168.86.30 iif br-lan.87
```

Expected results:

- An `o2gateway` host on `br-lan.86` routes `via 192.168.86.1 dev br-lan.86`.
- A `telekomgateway` host on `br-lan.86` routes `via 192.168.86.3 dev br-lan.86`.
- The same source tested as arriving on another interface falls back to the normal `wg0_pia` route.

Check DHCP syntax and service status:

```sh
for file in /var/etc/dnsmasq.conf*; do [ -f "$file" ] && dnsmasq --test -C "$file"; done
/etc/init.d/dnsmasq status
/etc/init.d/tag-gateway-routing enabled
```

Check redirects:

```sh
cat /proc/sys/net/ipv4/conf/all/send_redirects
cat /proc/sys/net/ipv4/conf/default/send_redirects
cat /proc/sys/net/ipv4/conf/br-lan.86/send_redirects
```

Each value should be `0`.

## Applying Changes

When changing static host tags in LuCI or `/etc/config/dhcp`, apply the routing rules again:

```sh
/usr/local/sbin/tag-gateway-routing apply
```

When changing DHCP tag options, reload dnsmasq:

```sh
uci commit dhcp
/etc/init.d/dnsmasq reload
```

Clients must renew DHCP before they receive the updated gateway option. Renew the client lease, reconnect Wi-Fi, or wait for lease renewal.

## Backup And Rollback

A full OpenWrt config backup was taken before the initial setup and copied locally to:

```text
/tmp/opencode/openwrt-before-tag-routing-20260626-1805.tar.gz
```

Take a fresh backup before future router changes:

```sh
sysupgrade -b /tmp/openwrt-before-routing-change.tar.gz
```

To disable the custom routing without changing DHCP tags:

```sh
/etc/init.d/tag-gateway-routing disable
rm -f /etc/hotplug.d/iface/95-tag-gateway-routing
while ip -4 rule del lookup 101 2>/dev/null; do true; done
while ip -4 rule del lookup 103 2>/dev/null; do true; done
ip -4 route flush table 101
ip -4 route flush table 103
```

To restore direct-client gateway behavior, change the DHCP tag options back to their old values and reload dnsmasq:

```sh
uci set dhcp.o2gateway.dhcp_option='3,192.168.86.1'
uci set dhcp.telekomgateway.dhcp_option='3,192.168.86.3'
uci commit dhcp
/etc/init.d/dnsmasq reload
```

Then renew DHCP on affected clients.
