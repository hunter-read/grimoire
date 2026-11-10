#!/bin/sh
# Rebuild Debian's libicudata without the locale data, in place.
#
#   trim_icu_data.sh
#
# unar links ICU through GNUstep, and ICU's data library is 30 MB: larger than
# unar, GNUstep and every other library they load put together. Nearly all of
# it describes languages - how 800 locales write dates, sort, name currencies
# and countries, break Thai or Japanese into words - and unar asks for none of
# that. What it does use is the character-set converters, to read file names
# out of archives written in Shift-JIS, CP437 and the rest.
#
# So this takes the data package out of the library, drops the per-locale
# resources and rebuilds the library around what is left (about 9 MB):
#
#   kept     every converter and its alias table, normalisation and string-prep
#            data, character names and properties, the root and English
#            resources, the root collation, and all the tables that are not
#            per-locale (time zones, plural rules, likely subtags, ...)
#   dropped  resources for locales other than root and English; and two whole
#            trees, word/line breaking with its dictionaries (brkitr) and
#            transliteration (translit), which an extractor has no use for
#
# A locale ICU has no data for falls back to root, which is how it already
# treats one it has never heard of. Nothing else in the image links ICU.
#
# Needs icu-devtools (icupkg, genccode) and binutils (nm, ld). Both
# architectures the image is built for are little-endian, hence the `l`.

set -eu

library="$(readlink -f "$(ls /usr/lib/*/libicudata.so.[0-9]*.[0-9]* | head -n 1)")"
soname="$(basename "$library" | cut -d. -f1-3)"  # libicudata.so.76

# "00000000000005a0 0000000001e60550 R icudt76_dat": where the package sits in
# the library, and how long it is. The library is nothing but that one symbol.
entry="$(nm -DS "$library" | awk '$4 ~ /^icudt[0-9]+_dat$/')"
offset="$(printf '%s' "$entry" | awk '{ print $1 }')"
size="$(printf '%s' "$entry" | awk '{ print $2 }')"
symbol="$(printf '%s' "$entry" | awk '{ print $4 }')"
package="${symbol%_dat}"  # icudt76

work="$(mktemp -d)"
dd if="$library" of="$work/full.dat" iflag=skip_bytes,count_bytes \
    skip="$((0x$offset))" count="$((0x$size))" status=none
# icupkg reads the package name out of the file name.
mv "$work/full.dat" "$work/${package}l.dat"

# A locale resource is named for its language code, two or three lower-case
# letters, with an optional _Script/_REGION tail: de.res, zh_Hant_TW.res, and
# the odd alias spelled de_.res. The tables that are not per-locale all have
# longer names (root, pool, plurals, zoneinfo64, ...), so the pattern cannot
# catch them. icupkg refuses to leave an item behind whose dependency it has
# been told to remove, so a tree has to go whole or not at all, and a miss here
# fails the build.
icupkg -l "$work/${package}l.dat" > "$work/items.txt"
{
    grep -E '(^|/)[a-z]{2,3}(_[A-Za-z0-9_]*)?\.res$' "$work/items.txt" \
        | grep -vE '(^|/)en(_[A-Za-z0-9_]*)?\.res$'
    grep -E '^(brkitr|translit)/' "$work/items.txt"
} | sort -u > "$work/remove.txt"

mkdir "$work/out"
icupkg -r "$work/remove.txt" "$work/${package}l.dat" "$work/out/${package}l.dat"
# -m: write the object file for the machine genccode itself was built for.
genccode -o -m "$(command -v genccode)" -n "$package" -e "$package" \
    -d "$work/out" "$work/out/${package}l.dat"
ld -shared -soname "$soname" -o "$work/out/$soname" "$work/out/${package}l_dat.o"
strip --strip-unneeded "$work/out/$soname"
cp "$work/out/$soname" "$library"
rm -rf "$work"
