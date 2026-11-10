#!/bin/sh
# Copy a tool out of a Debian image with only what it needs to run.
#
#   bundle_tool.sh DEST PATH...
#
# Each PATH is a program, or a file or folder of data it reads. They are copied
# under DEST at the same paths, along with every shared library the programs
# load (as `ldd` resolves them), so `COPY DEST/ /` puts a working tool into
# another image without the packages it came from. The Dockerfile uses this for
# unar and tesseract, whose packages depend on far more than the programs load.
#
# Left out, so a layer carries nothing twice:
#   * anything listed in /base-files, one path per line: the files the target
#     image already has (the Dockerfile writes it before installing anything);
#   * anything already in a bundle named in $SKIP_BUNDLES (space-separated).
#
# Only /usr and /etc paths come out, with /lib and /bin spelled as the /usr
# folders they link to: copying a real `lib/` over the target's `/lib` symlink
# would replace it. A library is stored under the name the loader asks for
# (libz.so.1) with the file's contents, not as a link to libz.so.1.3.1. A link
# inside a data folder stays a link (GNUstep's time zones point at
# /usr/share/zoneinfo).
#
# Fails if a program needs a library that is not installed.

set -eu

dest="$1"
shift

# copy PATH [cp option]: -L (the default) stores what a link points to.
copy() {
    target="$(readlink -f "$(dirname "$1")")/$(basename "$1")"
    if grep -qxF "$target" /base-files; then
        return 0
    fi
    for bundle in ${SKIP_BUNDLES:-}; do
        if [ -e "$bundle$target" ]; then
            return 0
        fi
    done
    mkdir -p "$dest$(dirname "$target")"
    cp -p "${2:--L}" "$1" "$dest$target"
}

for path in "$@"; do
    if [ -d "$path" ]; then
        find "$path" ! -type d | while read -r file; do
            copy "$file" -P
        done
        continue
    fi
    copy "$path"
    # Data files are not programs: ldd says so and exits non-zero.
    needed="$(ldd "$path" 2>/dev/null || true)"
    if printf '%s\n' "$needed" | grep -q 'not found'; then
        printf '%s needs a library that is not installed:\n%s\n' "$path" "$needed" >&2
        exit 1
    fi
    printf '%s\n' "$needed" | awk '$2 == "=>" && $3 ~ "^/" { print $3 }' | while read -r library; do
        copy "$library"
    done
done
