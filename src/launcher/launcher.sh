#!/bin/sh
# Many Hats launcher. Claude Code runs it as its process wrapper (claudeCode.claudeProcessWrapper):
#
#   launcher <claude binary> [claude arguments...]
#
# It decides which Claude account this one process runs on, then becomes that process (exec),
# so stdin, stdout, signals, the exit code and the pid all stay Claude's own.
#
# The account, in this order:
#   1. A session being resumed (--resume, -r or --session-id <id>) starts on the account it
#      belongs to: ~/.many-hats/assignments/<id>, kept by the extension.
#   2. A new tab the window asked to open on a given account claims ~/.many-hats/next/<pid of
#      the window's extension host>, which is this process's parent. Claiming is a rename, so
#      exactly one process gets it.
#   3. Anything else keeps the environment it was given: the window's account for new tabs.
#
# A login token in the environment (CLAUDE_CODE_OAUTH_TOKEN, which the Claude desktop app gives
# the processes it starts) would make Claude use that token's account whatever CLAUDE_CONFIG_DIR
# says, so it's removed together with the account details that come with it.
#
# It never stops Claude from starting. Without ~/.many-hats it changes nothing at all; a record
# it can't use is skipped; logging failures are ignored. Each decision is one line in
# ~/.many-hats/logs/launcher.log: time, pid, session, account and why. Never a secret.
#
# The extension installs this file as ~/.many-hats/bin/launcher. Edit src/launcher/launcher.sh.

launch() {
  # Normally $1 is the Claude binary Claude Code bundles. If it's missing, use a usual install.
  if [ -n "${1:-}" ] && [ -f "$1" ] && [ -x "$1" ]; then
    exec "$@"
  fi
  case "${1:-}" in */claude) shift ;; esac
  for candidate in "${HOME:-}/.local/bin/claude" "${HOME:-}/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    if [ -x "$candidate" ]; then
      exec "$candidate" "$@"
    fi
  done
  echo "Many Hats launcher: no Claude binary was given, and none was found in the usual places" >&2
  exit 127
}

# MANY_HATS_HOME exists for tests: a sandbox home that leaves HOME alone.
base="${MANY_HATS_HOME:-${HOME:-}}"
root="$base/.many-hats"
if [ -z "$base" ] || [ ! -d "$root" ]; then
  launch "$@"
fi

id=""
resuming=0
prev=""
for arg in "$@"; do
  case "$prev" in
    --resume | -r) id="$arg" resuming=1 ;;
    --session-id) id="$arg" ;;
  esac
  case "$arg" in
    --resume=*) id="${arg#*=}" resuming=1 ;;
    --session-id=*) id="${arg#*=}" ;;
  esac
  prev="$arg"
done
case "$id" in *[!0-9a-fA-F-]*) id="" ;; esac
[ "${#id}" -eq 36 ] || id=""

account=""
via="pick"
note=""
# `read` fails at a last line with no newline but still sets the variable, so its status is
# ignored; a file that can't be opened leaves the variable empty.
if [ -n "$id" ] && [ -f "$root/assignments/$id" ]; then
  { read -r account _rest < "$root/assignments/$id"; } 2>/dev/null
  via="assignment"
fi
if [ -z "$account" ] && [ "$resuming" -eq 0 ] && [ -f "$root/next/$PPID" ]; then
  claim="$root/next/$PPID.claimed.$$"
  if mv "$root/next/$PPID" "$claim" 2>/dev/null; then
    { read -r account _rest < "$claim"; } 2>/dev/null
    rm -f "$claim" 2>/dev/null
    via="next"
  fi
fi

case "$account" in
  "")
    via="pick"
    ;;
  default)
    if [ -n "${MANY_HATS_DEFAULT_DIR:-}" ]; then
      CLAUDE_CONFIG_DIR="$MANY_HATS_DEFAULT_DIR"
      export CLAUDE_CONFIG_DIR
    else
      unset CLAUDE_CONFIG_DIR
    fi
    ;;
  *[!a-z0-9_-]* | -* | _*)
    note="$via record held no account name"
    via="pick"
    ;;
  *)
    if [ "${#account}" -le 32 ] && [ -d "$root/accounts/$account" ]; then
      CLAUDE_CONFIG_DIR="$root/accounts/$account"
      export CLAUDE_CONFIG_DIR
    else
      note="$via names $account, which no longer exists"
      via="pick"
    fi
    ;;
esac

stripped=""
for v in CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_OAUTH_SCOPES CLAUDE_CODE_ACCOUNT_UUID CLAUDE_CODE_USER_EMAIL \
  CLAUDE_CODE_ORGANIZATION_UUID CLAUDE_CODE_SUBSCRIPTION_TYPE CLAUDE_CODE_RATE_LIMIT_TIER; do
  if eval "[ -n \"\${$v+set}\" ]"; then
    unset "$v"
    stripped="$stripped${stripped:+,}$v"
  fi
done

MANY_HATS_LAUNCHER=1
export MANY_HATS_LAUNCHER

# The account this process ends up on, for the log.
effective="${CLAUDE_CONFIG_DIR:-}"
if [ -z "$effective" ] || [ "$effective" = "${MANY_HATS_DEFAULT_DIR:-}" ]; then
  effective="default"
else
  case "$effective" in "$root/accounts/"*) effective="${effective#"$root/accounts/"}" ;; esac
fi
{
  logs="$root/logs"
  [ -d "$logs" ] || mkdir -m 700 "$logs" # $root exists, so this is one level and -m covers it
  size=$(wc -c < "$logs/launcher.log" | tr -d ' ')
  if [ "${size:-0}" -gt 262144 ]; then
    mv -f "$logs/launcher.log" "$logs/launcher.log.1"
  fi
  (
    umask 077
    printf '%s pid=%s session=%s account=%s via=%s%s%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "${id:-new}" \
      "$effective" "$via" "${note:+ note=\"$note\"}" "${stripped:+ removed=$stripped}" >> "$logs/launcher.log"
  )
} 2>/dev/null

launch "$@"
