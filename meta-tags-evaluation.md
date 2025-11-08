# ss56Meta Tags Evaluation: public.monster

**Prepared for:** Dmytri ([hello@dmytri.to](mailto:hello@dmytri.to))**Date:** November 8, 2025**Repository:** github.com/dmytri/public-monster

---

## Executive Summary

Evaluated three HTML pages (index.html, about.html, faq.html) for social embed, IndieWeb, and SEO meta tag implementation. Overall implementation is **solid** with good coverage of essential tags. Some opportunities for enhancement identified.

---

## Evaluation Results

### Social Embeds

#### Open Graph (Facebook, LinkedIn, etc.)

**Status:** ✅ **Good**

All pages include:

- `og:title` - Present and unique per page

- `og:description` - Present and unique per page

- `og:type` - Set to "website"

- `og:url` - Present and unique per page

**Missing:**

- ❌ `og:image` - No image specified for social previews

- ❌ `og:site_name` - Not specified (recommended)

- ❌ `og:locale` - Not specified (optional but useful)

**Impact:** Without `og:image`, social shares will appear text-only, reducing engagement and visual appeal.

#### Twitter Cards

**Status:** ⚠️ **Adequate but Limited**

All pages include:

- `twitter:card` - Set to "summary"

- `twitter:title` - Present and unique per page

- `twitter:description` - Present and unique per page

**Missing:**

- ❌ `twitter:image` - No image specified

- ❌ `twitter:site` - No Twitter handle specified

- ❌ `twitter:creator` - No creator handle specified

**Recommendation:** Consider upgrading to `summary_large_image` card type with an image for better visual presentation.

---

### IndieWeb

**Status:** ✅ **Good**

All pages include:

- `rel="me"` - Links to [https://dmytri.to](https://dmytri.to) (establishes identity )

- `rel="author"` - Links to [https://dmytri.to](https://dmytri.to) (establishes authorship )

**Strengths:**

- Proper identity verification links present

- Consistent across all pages

**Enhancement Opportunities:**

- Consider adding `rel="webmention"` endpoint for IndieWeb interactions

- Consider adding `h-card` microformat for richer identity information

- Consider adding `rel="pgpkey"` if relevant

---

### SEO

**Status:** ✅ **Good**

All pages include:

- `<title>` - Present, unique, and descriptive per page

- `meta name="description"` - Present, unique, and descriptive per page

- `meta charset="UTF-8"` - Proper character encoding

- `meta name="viewport"` - Mobile-responsive viewport

- `lang="en"` - Language attribute on html element

**Strengths:**

- Clean, semantic HTML structure

- Unique titles and descriptions per page

- Mobile-friendly viewport configuration

- Proper character encoding

**Enhancement Opportunities:**

- ❌ No structured data (JSON-LD) - Consider adding Schema.org markup

- ❌ No canonical URLs - Consider adding `rel="canonical"`

- ❌ No robots meta tag - Defaults are fine, but explicit control is better

- ❌ No theme-color meta tag for mobile browsers

---

## Priority Recommendations

### High Priority

1. **Add og:image and twitter:image**
  - Create a branded social share image (1200×630px recommended)
  - Add to all pages: `<meta property="og:image" content="https://public.monster/social-card.png">`
  - Add Twitter variant: `<meta name="twitter:image" content="https://public.monster/social-card.png">`
  - Optionally add image dimensions: `og:image:width`, `og:image:height`

1. **Add og:site_name**
  - `<meta property="og:site_name" content="public.monster">`

### Medium Priority

1. **Add Twitter handle**
  - `<meta name="twitter:site" content="@yourtwitterhandle">`
  - `<meta name="twitter:creator" content="@yourtwitterhandle">`

1. **Add canonical URLs**
  - `<link rel="canonical" href="https://public.monster/">`
  - `<link rel="canonical" href="https://public.monster/about">`
  - `<link rel="canonical" href="https://public.monster/faq">`

1. **Upgrade Twitter card type**
  - Change from `summary` to `summary_large_image` for better visual impact

### Low Priority

1. **Add structured data (JSON-LD )**
  - Consider adding Schema.org WebSite and Organization markup

1. **Add theme-color**
  - `<meta name="theme-color" content="#008080">` (matches your teal background)

1. **Add robots meta tag**
  - `<meta name="robots" content="index, follow">` (explicit is better than implicit)

---

## Sample Implementation

```html
<!-- Enhanced meta tags for index.html -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#008080">

<link rel="canonical" href="https://public.monster/">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>">

<title>public.monster</title>
<meta name="description" content="Your personal corner of the web. Upload HTML and go live instantly at public.monster/~yourusername">

<!-- Open Graph -->
<meta property="og:title" content="public.monster">
<meta property="og:description" content="Remember when the web was fun? Upload your HTML and go live instantly.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://public.monster">
<meta property="og:site_name" content="public.monster">
<meta property="og:image" content="https://public.monster/social-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@yourhandle">
<meta name="twitter:creator" content="@yourhandle">
<meta name="twitter:title" content="public.monster">
<meta name="twitter:description" content="Your personal corner of the web. Upload HTML and go live instantly.">
<meta name="twitter:image" content="https://public.monster/social-card.png">

<!-- IndieWeb -->
<link rel="me" href="https://dmytri.to">
<link rel="author" href="https://dmytri.to">
</head>
```

---

## Testing Tools

After implementing changes, validate with:

- **Open Graph:** [https://www.opengraph.xyz/](https://www.opengraph.xyz/)

- **Twitter Cards:** [https://cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator)

- **General Meta Tags:** [https://metatags.io/](https://metatags.io/)

- **SEO:** [https://search.google.com/test/rich-results](https://search.google.com/test/rich-results)

---

## Conclusion

Current implementation covers the **fundamentals well**. The main gap is the absence of social share images, which significantly impacts visual presentation on social platforms. Adding images and a few additional meta tags would bring the implementation to **excellent** status.

The IndieWeb implementation is solid with proper identity links. SEO basics are well-covered with unique titles, descriptions, and proper HTML structure.

---

**Contact:** Dmytri - [hello@dmytri.to](mailto:hello@dmytri.to)