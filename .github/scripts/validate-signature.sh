#!/usr/bin/env bash
# Checks that a signature PR adds exactly one valid signature file.
# Run by .github/workflows/validate-signature.yml from the base branch's copy,
# never from the pull request's.
set -euo pipefail
problems=()
# Hand every problem to the bot job, however this step ends.
emit() {
  {
    echo "problems<<SIGNATURE_PROBLEMS_EOF"
    for p in "${problems[@]+"${problems[@]}"}"; do echo "$p"; done
    echo "SIGNATURE_PROBLEMS_EOF"
  } >> "$GITHUB_OUTPUT"
}
trap emit EXIT
fail() { problems+=("$1"); echo "::error::$1"; exit 1; }
# Filenames come from the PR; strip anything that could be read as a workflow command.
safe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._/@ -'; }

# The PR's commit, as data only. Nothing below checks it out or runs it.
git fetch --no-tags -q origin "+refs/pull/${PR_NUMBER}/head:refs/remotes/pr/head"
[ "$(git rev-parse refs/remotes/pr/head)" = "$HEAD_SHA" ] || fail "The PR changed while this check was starting. Push again or re-run the check."

expected="signatures/${AUTHOR}.md"
# Three dots: compare against where the student's branch started, as the PR's
# "Files changed" tab does. Two dots would count every signature merged into
# main since they forked as a change of theirs.
changed="$(git diff --name-status "${BASE_SHA}...${HEAD_SHA}")"
echo "Files changed in this PR:"
printf '%s\n' "$changed" | while IFS= read -r line; do echo "  $(safe "$line")"; done

count="$(printf '%s\n' "$changed" | grep -c . || true)"
if [ "$count" -ne 1 ]; then
  others="$(printf '%s\n' "$changed" | cut -f2 | while IFS= read -r f; do [ "$f" = "$expected" ] || printf '`%s` ' "$(safe "$f")"; done)"
  fail "This PR changes $count files. It should change exactly one: \`$expected\`. Remove these from the PR: ${others}(if you see other people's files, you committed on main — see 'Stuck?' in the README)."
fi

status="$(printf '%s' "$changed" | cut -f1)"
path="$(printf '%s' "$changed" | cut -f2)"
[ "$path" = "$expected" ] || fail "Your file must be named exactly \`$expected\` — your GitHub username, capitals included. Yours is \`$(safe "$path")\`. Fix it with: \`git mv \"$(safe "$path")\" $expected\`"
case "$status" in A|M) ;; *) fail "Your signature file should be added, not deleted or renamed (git status: $(safe "$status"))." ;; esac

sig="$RUNNER_TEMP/signature.md"
git show "${HEAD_SHA}:${path}" > "$sig"
[ -s "$sig" ] || fail "\`$path\` is empty. Copy \`signatures/_template.md\` and fill it in."

# Content problems are collected, not fatal one at a time, so one run lists everything to fix.
first="$(head -n1 "$sig")"
if ! printf '%s' "$first" | grep -Eq '^# .+'; then
  problems+=("The first line must be your name after \`# \`, for example \`# Asha Rao\`.")
elif printf '%s' "$first" | grep -Eiq '^#[[:space:]]*Your Name[[:space:]]*$'; then
  problems+=("The first line still says \`# Your Name\`. Replace *Your Name* with your real name and keep the \`# \`, for example \`# Asha Rao\`.")
fi
grep -Eqi -- "^- \*\*GitHub:\*\* @${AUTHOR}[[:space:]]*$" "$sig" \
  || problems+=("The GitHub line must be exactly \`- **GitHub:** @${AUTHOR}\` — with the \`@\` and a space after the colon.")
for field in "Batch" "I'm here to" "One thing I've built"; do
  grep -Fq -- "- **${field}:**" "$sig" || problems+=("The \`- **${field}:**\` line from the template is missing.")
done
grep -Fq "one honest line about what you want" "$sig" && problems+=("\`I'm here to\` still has the template text. Write your own line.")

if [ "${#problems[@]}" -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::error::$p"; done
  exit 1
fi
echo "✅ Signature looks good."
