# RustROOM - Lightroom-oriented port progress

## Scope
Public LR Classic layout + XMP develop presets.
**No** Adobe binary RE / **no** Adobe assets / **no** pixel-identical proprietary chrome.

## Parser + sidecars
- preset_converter: **49** · xmp_sidecar: **40**
- hierarchicalSubject · stack:/flag: · dc:title · DateCreated
- Full IPTC suite · CaptionWriter · DigitalSourceType · Creator contact/address

## UI (LR-like, original chrome)
### Metadata chips …/SL/**CC/UT** · filmstrip countrycode/usageterms
### List columns … State · **Headline** · Creator/Credit/City/Country
### Catalog Has Country Code · Usage Terms · Sub-location · …
### Stats CC/UT/HL · Alt+I (country code) · Alt+U (usage terms)
### Sort country_code / usage_terms / headline / location suite
### Library views Shift+1–6 · Compare Enter/Tab · soft-proof · Loupe Z

## Goal
**Active** — Adobe pixel-identical intentionally out of scope.
