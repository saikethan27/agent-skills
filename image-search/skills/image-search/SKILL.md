---
name: image-search
description: Find stock photos, decor or product imagery, and hero images across Unsplash, Pixabay, and Openverse.
---

# Image search

Run searches with the bundled standard-library CLI:

```sh
python scripts/image_search.py search "<query>" --json
```

For every result shown to the user, include its thumbnail URL, creator, license, source page, and the complete attribution text. Prefer commercially usable licenses. Clearly flag any result whose license is noncommercial, unclear, or otherwise not suitable for the intended commercial use.

- If a provider reports a missing API key, say which key is needed and continue using the other providers.
- For Unsplash, when the user actually chooses an image, call `python scripts/image_search.py track-download "<download_location>"` and credit the photographer in the final use.
- For Pixabay, download the chosen image with `python scripts/image_search.py download "<full_url>" --out <directory>` and self-host that local file instead of hotlinking it.
- Openverse results can have different license terms; check and report the license for the specific image before recommending it for commercial use.

The CLI reads `UNSPLASH_ACCESS_KEY` and `PIXABAY_API_KEY` from the environment. Openverse works without credentials; `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` are optional. Never request, print, or store credential values.
