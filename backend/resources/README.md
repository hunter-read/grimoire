# Bundled resources

## common-passwords.txt.gz

Lower-cased, de-duplicated list of commonly used passwords, one per line. New
passwords that appear in it are refused (see `backend/passwords.py`). Built from:

- [SecLists](https://github.com/danielmiessler/SecLists) `Passwords/Common-Credentials/10k-most-common.txt` (MIT licence), in full.
- The UK NCSC "100k most used passwords" list, as published in SecLists
  (`100k-most-used-passwords-NCSC.txt`), entries of 8 characters or more.

To rebuild, download both files and run:

```python
import gzip

top10k = [l.strip() for l in open("10k-most-common.txt", encoding="utf-8", errors="ignore") if l.strip()]
ncsc = [l.strip() for l in open("100k-most-used-passwords-NCSC.txt", encoding="utf-8", errors="ignore") if l.strip()]
entries = {p.lower() for p in top10k} | {p.lower() for p in ncsc if len(p) >= 8}
with gzip.GzipFile("common-passwords.txt.gz", "wb", compresslevel=9, mtime=0) as f:
    f.write(("\n".join(sorted(entries)) + "\n").encode())
```
