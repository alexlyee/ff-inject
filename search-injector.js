/* Foam Factory AI Search — storefront DOM injector.
   Runs on every page via the head_tag resource group. On SRCH pages, fetches
   AI-ranked results from the Cloudflare-tunneled backend and replaces Miva's
   native product list with AI hits using Miva's own .x-product-list markup.
   Categories and Miva pages surface alongside products; each hit renders with
   a type badge so customers can tell products apart from categories apart from
   resource pages at a glance. */
(function(){
  var API = 'https://debian-rise-subscribers-schools.trycloudflare.com/search';
  // Injector build tag — shown in the console banner so a live/over-break page
  // can be matched to a deploy. Date-based; bump the -N suffix on same-day redeploys.
  var VERSION = '2026.05.29-1';

  // Anonymous per-browser session id, stored first-party in localStorage on
  // the storefront. No PII — just a random tag so the backend can count
  // distinct sessions and reconstruct each one's query path for retroactive
  // analysis. Persists across page loads; regenerates only if cleared.
  function sessionId(){
    try {
      var k = 'ff_sid', v = localStorage.getItem(k);
      if (!v) {
        v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem(k, v);
      }
      return v;
    } catch(e) { return ''; }  // private mode / storage blocked → anonymous
  }

  // Immediately hide the native product list on search pages to prevent
  // flash of native content (FOUC) before AI results load. The CSS rule
  // is injected synchronously in <head>, so it takes effect before the
  // browser paints the body. injectHits() removes this after replacing.
  // Safety: a 1-second timeout removes the hide CSS if AI results never
  // arrive (backend down, JS error, param mismatch, etc.) so the page
  // is never permanently blank.
  if (location.search.indexOf('Screen=SRCH') !== -1 ||
      location.search.indexOf('Screen=SEARCH') !== -1 ||
      location.pathname.indexOf('/product-search') !== -1 ||
      location.pathname.indexOf('/search.html') !== -1) {
    var hideStyle = document.createElement('style');
    hideStyle.id = 'ff-ai-hide';
    hideStyle.textContent = '#js-product-list, section.x-product-list:not(.t-featured-products), .gsc-control-cse, #content-item, .gcse-searchresults-only, .gsc-above-wrapper-area { visibility: hidden; min-height: 200px; }';
    document.head.appendChild(hideStyle);
    setTimeout(function(){
      var s = document.getElementById('ff-ai-hide');
      if (s) { s.remove(); console.warn('[foamfactory-ai] timeout — revealing native results'); }
    }, 1000);
  }

  // Inline SVG placeholder (data URI). Branded gray gradient tile — stands in
  // for real product photos until per-product AI-generated imagery lands
  // (FLUX.1-schnell on the Ascent, planned). Using a data URI means no
  // second HTTP request, no external dependency, no broken-image fallback.
  var PLACEHOLDER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#eef1f6"/>' +
        '<stop offset="1" stop-color="#d0d6e0"/>' +
      '</linearGradient></defs>' +
      '<rect width="360" height="360" fill="url(%23g)"/>' +
      '<g fill="#fff" opacity="0.55"><circle cx="180" cy="160" r="64"/></g>' +
      '<text x="180" y="170" text-anchor="middle" ' +
        'font-family="system-ui,-apple-system,sans-serif" ' +
        'font-size="18" font-weight="600" fill="#5a6677">FF</text>' +
      '<text x="180" y="260" text-anchor="middle" ' +
        'font-family="system-ui,-apple-system,sans-serif" ' +
        'font-size="14" fill="#7a8699">Foam Factory</text>' +
    '</svg>';
  var PLACEHOLDER_URI =
    'data:image/svg+xml;utf8,' + encodeURIComponent(PLACEHOLDER_SVG);

  // Type badges use shades of the site's own brand color rather than a
  // green/orange/blue rainbow — reads more on-brand and cohesive. US site =
  // shades of the brand blue (#095eab); Canada = shades of the brand red
  // (#bf221c). Deep→medium→pale gradient (product→category→page); all
  // contrast >=4.5:1 (white text on the two darker, deep text on the pale).
  var BADGE_STYLES_BLUE = {
    product:  'background:#08559a;color:#fff;',
    category: 'background:#3379b9;color:#fff;',
    page:     'background:#d3e2f0;color:#074d8c;',
  };
  var BADGE_STYLES_RED = {
    product:  'background:#ac1f19;color:#fff;',
    category: 'background:#cb4a45;color:#fff;',
    page:     'background:#f3d7d6;color:#9d1c17;',
  };
  function isCanadaSite(){
    return location.hostname.indexOf('canada') !== -1 || !!window.FF_CANADA;
  }
  function badgeStyles(){ return isCanadaSite() ? BADGE_STYLES_RED : BADGE_STYLES_BLUE; }
  var BADGE_LABEL = { product: 'Product', category: 'Category', page: 'Page' };

  function onProductSearchPage(){
    return location.search.indexOf('Screen=SRCH') !== -1 ||
           location.pathname.indexOf('/product-search') !== -1;
  }

  function onSiteSearchPage(){
    // "Search Site" submits to Screen=SEARCH with q= param (Google CSE page)
    return location.search.indexOf('Screen=SEARCH') !== -1 ||
           location.pathname.indexOf('/search.html') !== -1;
  }

  function onSearchPage(){
    return onProductSearchPage() || onSiteSearchPage();
  }

  function getQuery(){
    var p = new URLSearchParams(location.search);
    // Product search: 'Search' or 'search'. Site search: 'q'.
    return (p.get('Search') || p.get('search') || p.get('q') || '').trim();
  }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  }); }

  function appendTrackingParam(href, hash){
    // Miva's friendly URLs (*.html) return 404 with unknown query params —
    // even product-display.html?Product_Code=X&ff_q=Y breaks. Skip all .html URLs.
    if (href.indexOf('.html') !== -1) return href;
    var sep = href.indexOf('?') === -1 ? '?' : '&';
    return href + sep + 'ff_q=' + encodeURIComponent(hash);
  }

  function buildHref(hit, hash){
    // On the Canada site, link to the Canada product/category URL when one
    // exists (canada_url_path is an absolute canada.foambymail.com URL).
    if (isCanadaSite() && hit.canada_url_path) {
      return appendTrackingParam(hit.canada_url_path, hash);
    }
    // location.origin lets the same jsDelivr-hosted script work on both
    // competitivefoam.com (dev) and foambymail.com (live) without rebuild.
    // Absolute url_path (e.g. blog links back to foambymail.com) are respected
    // as-is; relative url_path resolves against whichever store is serving
    // the page the customer is currently on.
    var origin = location.origin;
    var base;
    if (hit.url_path) {
      base = (hit.url_path.indexOf('http') === 0)
        ? hit.url_path
        : origin + (hit.url_path.charAt(0) === '/' ? '' : '/') + hit.url_path;
    } else {
      base = origin + '/mm5/merchant.mvc?Screen=PROD&Product_Code=' +
        encodeURIComponent(hit.code);
    }
    return appendTrackingParam(base, hash);
  }

  function buildImageSrc(hit){
    // Backend returns hit.image as a relative path (e.g. 'graphics/00000001/foo.jpg')
    // when Miva has an image for this product, empty string otherwise.
    //
    // Miva's image-URL convention on this storefront: the API returns the
    // original-file path under graphics/00000001/, but those root-level
    // originals are inconsistently present (most 404, some 200). Miva
    // auto-generates a WebP variant in the /1/ subdirectory under
    // /Merchant2/, and THAT variant exists for every catalog image.
    // Transform: graphics/00000001/foo.jpg → Merchant2/graphics/00000001/1/foo.webp
    //
    // location.origin keeps this working on competitivefoam.com (dev) and
    // foambymail.com (live) without rebuild — both Miva installs follow the
    // same image-pipeline convention.
    if (hit.image) {
      var rel = hit.image;
      if (rel.indexOf('http') === 0) return rel;
      var path = rel
        .replace(/^\/?graphics\/(\d+)\//, 'Merchant2/graphics/$1/1/')
        .replace(/\.(jpe?g|png|gif)$/i, '.webp');
      return location.origin + '/' + path;
    }
    return PLACEHOLDER_URI;
  }

  // Detect which theme we're on: Shadows (competitivefoam) vs 2016_Framework (foambymail).
  // Lazy — evaluated on first use (after DOMContentLoaded) so the DOM query works.
  var _is_fbm = null;
  function IS_FBM() {
    if (_is_fbm === null) {
      _is_fbm = !!document.querySelector('#js-product-list') || location.hostname.indexOf('foambymail') !== -1;
    }
    return _is_fbm;
  }

  function siteSearchCardHTML(hit, hash){
    // Site search card — shows all types with badge, breadcrumb, and richer layout.
    // Used on the "Search Site" page (Screen=SEARCH) to replace Google CSE.
    var href = buildHref(hit, hash);
    var type = hit.type || 'product';
    var linkColor = isCanadaSite() ? '#bf221c' : '#2d6cdf';
    // Square badge (border-radius:2px) to match foambymail.com's rectangular UI.
    // inline-flex + align-items:center + line-height:1 vertically centers the
    // label (inline-block let short labels like "Product" ride high at cap-height).
    // No margin-right — the row's gap:8px already spaces badge↔title; the old
    // margin stacked with it for a 16px gap while everything else was 8px.
    var badgeCss = 'display:inline-flex;align-items:center;padding:3px 8px;border-radius:2px;' +
      'font-size:11px;font-weight:600;letter-spacing:.02em;line-height:1;' +
      (badgeStyles()[type] || badgeStyles().product);
    // Label page-type hits as "Blog" when they're blog posts (/blog/ URL),
    // since all page-type results in this catalog are WP blog articles.
    var badgeText = BADGE_LABEL[type] || type;
    if (type === 'page' && (hit.url_path || '').indexOf('/blog/') !== -1) badgeText = 'Blog';
    var imgSrc = buildImageSrc(hit);
    var snippet = (hit.snippet || '').substring(0, 160);
    if (snippet && hit.snippet && hit.snippet.length > 160) snippet += '...';
    var price = (hit.price && hit.price > 0) ? ('$' + Number(hit.price).toFixed(2)) : '';
    var startPrice = (hit.starting_at_price && hit.starting_at_price > 0) ? ('$' + Number(hit.starting_at_price).toFixed(2)) : '';
    var priceHTML = startPrice
      ? '<span style="color:#c46a1e;font-weight:600;font-size:14px;margin-left:auto;">Starting at ' + startPrice + '</span>'
      : (price ? '<span style="color:#c46a1e;font-weight:600;font-size:14px;margin-left:auto;">' + price + '</span>' : '');
    // Breadcrumb / tags row — clickable, mirrors the dev preview:
    //   blog (has tags)   → comma-separated clickable WP tag links
    //   product/category  → "Top > Mid > Leaf", each segment links to /<code>.html
    //   fallback          → plain breadcrumb text
    var crumbStyle = 'font-size:12px;color:#888;margin-top:4px;font-family:ui-monospace,monospace;';
    var crumbLink = 'color:#888;text-decoration:none;border-bottom:1px dotted #bbb;';
    var breadcrumb = '';
    if (hit.tags && hit.tags.length) {
      breadcrumb = '<div style="' + crumbStyle + '">' + hit.tags.map(function(t){
        return '<a href="' + esc(t.url || '#') + '" style="' + crumbLink + '">' + esc(t.name || '') + '</a>';
      }).join(', ') + '</div>';
    } else if (hit.breadcrumb_segments && hit.breadcrumb_segments.length) {
      var paths = hit.breadcrumb_segments.map(function(path){
        return path.map(function(seg){
          // /<code>.html friendly URL — no ff_q (friendly URLs 404 with extra params)
          return '<a href="' + location.origin + '/' + esc(seg.code) + '.html" style="' + crumbLink + '">' + esc(seg.name) + '</a>';
        }).join(' &gt; ');
      });
      breadcrumb = '<div style="' + crumbStyle + '">' + paths.join(' &middot; ') + '</div>';
    } else if (hit.breadcrumb) {
      breadcrumb = '<div style="' + crumbStyle + '">' + esc(hit.breadcrumb).substring(0, 120) + '</div>';
    }
    var imgHTML = imgSrc && imgSrc !== PLACEHOLDER_URI
      ? '<a href="' + href + '" style="flex:0 0 80px;"><img src="' + imgSrc + '" alt="" loading="lazy" style="width:80px;height:80px;object-fit:cover;border-radius:4px;" onerror="this.parentNode.style.display=\'none\'"></a>'
      : '';
    return '' +
      '<div class="column whole" data-ai-rank="1" data-ai-type="' + esc(type) + '" style="padding:14px 0;border-bottom:1px solid #eee;display:flex;gap:14px;align-items:flex-start;">' +
        imgHTML +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">' +
            '<span style="' + badgeCss + '">' + esc(badgeText) + '</span>' +
            '<a href="' + href + '" style="font-weight:600;color:' + linkColor + ';text-decoration:none;font-size:15px;">' + esc(hit.name) + '</a>' +
            (hit.code ? '<span style="font-family:monospace;font-size:11px;color:#c2c2c2;font-weight:400;">' + esc(hit.code) + '</span>' : '') +
            priceHTML +
          '</div>' +
          (snippet ? '<div style="color:#555;font-size:13px;margin-top:4px;line-height:1.4;">' + esc(snippet) + '</div>' : '') +
          breadcrumb +
        '</div>' +
      '</div>';
  }

  function cardHTML(hit, hash){
    var href = buildHref(hit, hash);
    var price = (hit.price && hit.price > 0) ? ('$' + Number(hit.price).toFixed(2)) : '';
    var startPrice = (hit.starting_at_price && hit.starting_at_price > 0) ? ('$' + Number(hit.starting_at_price).toFixed(2)) : '';
    var type = hit.type || 'product';
    var badgeCss = 'display:inline-block;padding:2px 8px;border-radius:10px;' +
      'font-size:11px;font-weight:600;letter-spacing:.02em;margin-bottom:6px;' +
      (badgeStyles()[type] || badgeStyles().product);
    var badgeText = BADGE_LABEL[type] || type;
    var imgSrc = buildImageSrc(hit);
    var snippet = (hit.snippet || '').substring(0, 100);
    if (snippet && hit.snippet && hit.snippet.length > 100) snippet += '...';

    if (IS_FBM()) {
      // foambymail.com 2016_Framework layout: 3-column row (image | name+desc | price)
      var priceHTML = startPrice
        ? '<p class="starting-price"><strong>Starting at ' + startPrice + '</strong></p>'
        : (price ? '<p class="starting-price"><strong>' + price + '</strong></p>' : '');
      return '' +
        '<div class="column whole category-product" data-ai-rank="1" data-ai-type="' + esc(type) + '">' +
          '<a href="' + href + '" title="' + esc(hit.name) + '" class="column one-third large-one-sixth medium-one-sixth small-one-sixth">' +
            '<span class="flag flag--">' +
              '<img src="' + imgSrc + '" alt="' + esc(hit.name) + '" loading="lazy" onerror="this.src=\'' + PLACEHOLDER_URI + '\';this.onerror=null">' +
            '</span>' +
          '</a>' +
          '<div class="column two-thirds large-three-sixths medium-three-sixths small-three-sixths">' +
            '<h4><a href="' + href + '" class="blue">' + esc(hit.name) + '</a></h4>' +
            (hit.code ? '<span class="product-code">Code: ' + esc(hit.code) + '</span>' : '') +
            (snippet ? '<p>' + esc(snippet) + ' <a href="' + href + '"><span class="decoration">Read More</span></a></p>' : '') +
          '</div>' +
          '<div class="column whole large-two-sixths medium-two-sixths small-two-sixths align-center">' +
            '<div class="float-none large-float-right medium-float-right small-float-right">' +
              priceHTML +
              '<a href="' + href + '"><span class="more-info orange decoration">More Info &raquo;</span></a>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    // Shadows framework (competitivefoam.com) — existing card layout
    return '' +
      '<div class="o-layout__item u-text-center x-product-list__item" data-ai-rank="1" data-ai-type="' + esc(type) + '">' +
        '<a class="u-block x-product-list__link" href="' + href + '" title="' + esc(hit.name) + '">' +
          '<figure class="x-product-list__figure">' +
            '<img class="x-product-list__image" src="' + imgSrc + '" alt="" loading="lazy" style="width:100%;height:auto;display:block;margin:0 auto" width="360" height="360" onerror="this.src=\'' + PLACEHOLDER_URI + '\';this.onerror=null">' +
            '<figcaption>' +
              '<span style="' + badgeCss + '">' + esc(badgeText) + '</span><br>' +
              '<strong class="x-product-list__name">' + esc(hit.name) + '</strong>' +
              (price ? '<span class="x-product-list__price">' + price + '</span>' : '') +
            '</figcaption>' +
          '</figure>' +
        '</a>' +
      '</div>';
  }

  function injectHits(hits, ffQ, elapsedMs){
    if (!hits || !hits.length) return;

    var isSiteSearch = onSiteSearchPage();
    var container;

    if (isSiteSearch) {
      // Site search (Screen=SEARCH): replace Google CSE content
      container = document.querySelector('#content-item') || document.querySelector('.gsc-control-cse');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ff-site-search-results';
        container.className = 'row';
        var host = document.querySelector('.main-content') || document.querySelector('main') || document.body;
        host.appendChild(container);
      } else {
        container.innerHTML = '';
      }
    } else if (IS_FBM()) {
      // foambymail.com product search: product list is #js-product-list
      container = document.querySelector('#js-product-list');
      if (!container) {
        var noResults = document.querySelector('.italic') ||
          Array.from(document.querySelectorAll('p')).find(function(el){ return /no products matched/i.test(el.textContent || ''); });
        container = document.createElement('div');
        container.id = 'js-product-list';
        container.className = 'row';
        if (noResults && noResults.closest('.row')) {
          noResults.closest('.row').replaceWith(container);
        } else {
          var host = document.querySelector('#js-SRCH .row') || document.querySelector('#js-SRCH') || document.body;
          host.appendChild(container);
        }
      } else {
        container.innerHTML = '';
      }
    } else {
      // Shadows (competitivefoam.com): product list is section.x-product-list
      container = document.querySelector('section.x-product-list:not(.t-featured-products)');
      if (!container) {
        var noResults = Array.from(document.querySelectorAll('h2, h3, p, div'))
          .find(function(el){ return /no products matched/i.test(el.textContent || ''); });
        container = document.createElement('section');
        container.className = 'o-layout u-grids-2 u-grids-3--l x-product-list';
        if (noResults && noResults.parentNode) {
          noResults.parentNode.replaceChild(container, noResults);
        } else {
          var host = document.querySelector('main') || document.querySelector('#js-SRCH') || document.body;
          host.appendChild(container);
        }
      } else {
        container.innerHTML = '';
      }
    }

    // Filter and render based on page type
    var filtered;
    if (isSiteSearch) {
      // Site search: all types, but scope products/categories to the current
      // site. Blogs are shared so always shown. On Canada, show only items
      // available there (have canada_url_path, or are Canada-only entries);
      // on US, exclude Canada-only entries.
      var ca = isCanadaSite();
      filtered = hits.filter(function(h){
        if (h.type === 'page') return true;
        var urlIsCanada = h.url_path && h.url_path.indexOf('canada.foambymail.com') !== -1;
        if (ca) return !!h.canada_url_path || urlIsCanada;   // Canada-available only
        return !urlIsCanada;                                  // US: drop Canada-only
      });
    } else if (IS_FBM()) {
      // Product search on FBM: products only, exclude Canada-only.
      // Canada-only products have url_path pointing to canada.foambymail.com
      // AND no US-specific url_path (url_path === canada_url_path).
      filtered = hits.filter(function(h){
        if ((h.type || 'product') !== 'product') return false;
        var isCanadaOnly = (h.url_path && h.url_path.indexOf('canada.foambymail.com') !== -1) &&
                           (!h.url_path.match(/Product_Code=/));
        return !isCanadaOnly;
      });
    } else {
      // Shadows/dev store: all types with banner
      filtered = hits;
      var bannerClass = 'o-layout__item u-width-12 u-text-center u-font-small';
      var banner = document.createElement('div');
      banner.className = bannerClass;
      banner.style.cssText = 'padding:10px;background:#f7f9ff;border-left:3px solid #2d6cdf;margin-bottom:12px;color:#2d6cdf;';
      banner.textContent = 'AI-ranked results for "' + getQuery() + '" (' + hits.length + ' matches)';
      container.appendChild(banner);
    }

    // Use the site search card layout (with badges + breadcrumbs) on the
    // Search Site page; use the native product card layout elsewhere.
    var cardFn = isSiteSearch ? siteSearchCardHTML : cardHTML;

    if (isSiteSearch) {
      // Site search: a results-count line + client-side "load more". One
      // fetch returned all reasonably-relevant hits (backend score floor);
      // we reveal them in batches from memory — no extra round-trips.
      var PAGE = 12;
      var shown = 0;
      var brand = isCanadaSite() ? '#bf221c' : '#08559a';

      // --- Type filter chips (Carlo-approved 5/29 meeting) ---
      // All types start selected. Clicking a chip toggles it. Re-renders
      // from memory (no new fetch). Count line + load-more update to match.
      var typeSet = {};
      filtered.forEach(function(h){ typeSet[h.type || 'product'] = true; });
      var availableTypes = Object.keys(typeSet);  // e.g. ['product','category','page']
      var activeTypes = {}; availableTypes.forEach(function(t){ activeTypes[t] = true; });
      var CHIP_LABELS = {product:'Products', category:'Categories', page:'Blogs'};

      // Hide native Miva "Site Search" / "Search Results for:" headers —
      // our count line + chips replace them.
      var nativeHeaders = container.parentElement ?
        container.parentElement.querySelectorAll('h2, h3, .search-results-header') : [];
      nativeHeaders.forEach(function(el){
        if (/site search|search results for/i.test(el.textContent)) el.style.display = 'none';
      });

      var chipRow = document.createElement('div');
      chipRow.style.cssText = 'display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap;align-items:center;';
      // Muted hint so customers know the chips are interactive
      var hint = document.createElement('span');
      hint.textContent = 'filter:';
      hint.style.cssText = 'font-size:12px;color:#aaa;margin-right:2px;';
      chipRow.appendChild(hint);
      var chipEls = {};
      // Chips use the SAME colors as the per-type result badges (product=deep,
      // category=medium, page=pale). Grey when deselected.
      var badges = badgeStyles();
      var chipBase = 'display:inline-block;padding:4px 12px;border-radius:2px;font-size:13px;' +
        'font-weight:600;cursor:pointer;user-select:none;';
      var chipOff = chipBase + 'background:#e4e4e4;color:#999;';
      availableTypes.forEach(function(t){
        var chip = document.createElement('span');
        chip.textContent = CHIP_LABELS[t] || t;
        chip.style.cssText = chipBase + (badges[t] || badges.product);
        chip.addEventListener('click', function(){
          activeTypes[t] = !activeTypes[t];
          chip.style.cssText = activeTypes[t]
            ? chipBase + (badges[t] || badges.product)
            : chipOff;
          rerender();
        });
        chipRow.appendChild(chip);
        chipEls[t] = chip;
      });
      container.appendChild(chipRow);

      var countLine = document.createElement('div');
      countLine.style.cssText = 'font-size:13px;color:#888;margin:0 0 14px;';
      container.appendChild(countLine);

      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.style.cssText = 'display:inline-block;margin:0 0 24px;padding:10px 24px;' +
        'background:' + brand + ';color:#fff;border:none;border-radius:3px;' +
        'font-size:14px;font-weight:600;cursor:pointer;';

      // Active-filtered subset + render logic. rerender() is called on chip
      // toggle; renderNext() appends the next PAGE from the active set.
      var activeFiltered = [];
      var secs = ((elapsedMs || 0) / 1000).toFixed(2);
      function updateCount(){
        countLine.textContent = activeFiltered.length + ' result' +
          (activeFiltered.length === 1 ? '' : 's') + ' (' + secs + ' seconds)';
      }
      function renderNext(){
        activeFiltered.slice(shown, shown + PAGE).forEach(function(h){
          var tmp = document.createElement('div');
          tmp.innerHTML = cardFn(h, ffQ || '');
          container.insertBefore(tmp.firstChild, btnWrap);
        });
        shown = Math.min(shown + PAGE, activeFiltered.length);
        if (shown >= activeFiltered.length) moreBtn.style.display = 'none';
        else { moreBtn.style.display = ''; moreBtn.textContent = 'Load more results (' + (activeFiltered.length - shown) + ' more)'; }
      }
      function rerender(){
        // Remove existing cards (everything between chipRow and btnWrap)
        var cards = container.querySelectorAll('[data-ai-type]');
        cards.forEach(function(c){ c.remove(); });
        activeFiltered = filtered.filter(function(h){ return activeTypes[h.type || 'product']; });
        shown = 0;
        updateCount();
        renderNext();
      }
      // foambymail.com's .column class uses float:left (2016-era grid).
      // A non-floated button after floated cards has NO gap above it because:
      //   - margin-top on a non-floated block is relative to the container
      //     top (not the float bottom), so it sits behind/on the floats.
      //   - clear:both moves it below floats, but clearance ABSORBS the
      //     margin-top (CSS2.1 §8.3.1) — gap still 0.
      //   - A clear:both spacer div with height:24px gets its height eaten
      //     by clearance expansion — rendered height ~132px, gap still 0.
      // Fix: wrap the button in a .column.whole div so it floats like the
      // cards. Margins between adjacent floats work normally. The wrapper's
      // padding-top:24px creates the visible gap above the button.
      var btnWrap = document.createElement('div');
      btnWrap.className = 'column whole';
      btnWrap.style.cssText = 'text-align:center;padding:24px 0 0;border:none;';
      btnWrap.appendChild(moreBtn);
      container.appendChild(btnWrap);
      moreBtn.addEventListener('click', function(){
        renderNext();
        console.info('[foamfactory-ai] showing ' + Math.min(shown, activeFiltered.length) +
          ' of ' + activeFiltered.length + ' results');
      });
      rerender();  // initial render with all types active
    } else {
      filtered.forEach(function(h){
        var tmp = document.createElement('div');
        tmp.innerHTML = cardFn(h, ffQ || '');
        container.appendChild(tmp.firstChild);
      });
    }

    // Hide leftover Google CSE elements (search input box, branding bar) so only
    // AI results remain. Targets CSE sub-elements, NOT .gsc-control-cse itself
    // (which may be our container). On the demo proxies, CSE scripts are blocked
    // entirely; this is the live-site defense for when CSE JS does load.
    document.querySelectorAll('.gsc-search-box, .gsc-above-wrapper-area, .gsc-input-box')
      .forEach(function(el){ el.style.display = 'none'; });

    // Reveal — remove the FOUC-prevention CSS now that AI results are in place
    var hideStyle = document.getElementById('ff-ai-hide');
    if (hideStyle) hideStyle.remove();
    container.style.visibility = 'visible';
  }

  function pingConversion(){
    // Runs on any page (PROD, BASK, OCNF, etc). If the current URL carries an
    // ff_q tracking hash, tell the backend which kind of post-search event
    // this is (view vs order). Backend joins the hash back to the original
    // query for downstream analysis.
    var p = new URLSearchParams(location.search);
    var h = p.get('ff_q');
    if (!h) return;
    var screen = (p.get('Screen') || '').toUpperCase();
    var event = 'view';
    if (screen === 'OCNF' || /invoice|order[-_ ]?confirmation/i.test(document.title)) {
      event = 'order';
    }
    var api = 'https://debian-rise-subscribers-schools.trycloudflare.com/log_conversion';
    try {
      // navigator.sendBeacon fire-and-forget so it survives page teardown
      // during checkout redirects.
      var data = JSON.stringify({ ff_q: h, event: event, screen: screen,
                                  session: sessionId(),
                                  url: location.href, ref: document.referrer });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(api, new Blob([data], {type: 'application/json'}));
      } else {
        fetch(api, { method: 'POST', body: data,
                     headers: {'Content-Type': 'application/json'},
                     keepalive: true });
      }
    } catch (e) { /* silent — tracking must never break the page */ }
  }

  function injectNoindex(){
    // Search result pages should not be indexed (Amy Heath, 4/23 SEO memo —
    // ?Search= URLs would create a duplicate-content / parameter-indexing
    // footprint). Client-side injection is belt-and-suspenders; the proper
    // fix is adding this to Miva's SRCH screen template server-side.
    if (document.querySelector('meta[name="robots"]')) return;
    var m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex,follow';
    document.head.appendChild(m);
  }

  function run(){
    pingConversion();
    if (!onSearchPage()) return;
    injectNoindex();
    var q = getQuery();
    if (!q) return;

    // Check if the server-side component module already fetched results.
    // If #ff-ai-data exists with data-response, use it directly and skip
    // the redundant backend call. This is the optimized path when the
    // Miva module's ComponentModule_Initialize fires before this JS.
    var prefetched = document.getElementById('ff-ai-data');
    if (prefetched && prefetched.getAttribute('data-response')) {
      try {
        var data = JSON.parse(prefetched.getAttribute('data-response'));
        injectHits(data.hits || [], data.ff_q, data.elapsed_ms);
        return;
      } catch(e) { /* fall through to fetch */ }
    }

    // Read ProductsPerPage from URL (Miva's VIEW 12/24/All control).
    // 12 = default, 24 = expanded, 9999 = All. Empty/missing = 12.
    var urlParams = new URLSearchParams(location.search);
    var ppp = parseInt(urlParams.get('ProductsPerPage'), 10);
    var limit = (ppp > 0 && ppp < 9999) ? ppp : (ppp >= 9999 ? 100 : 12);

    // Product search: products only, paged by Miva's VIEW selector. Site
    // search: all types, one generous fetch (48) that the load-more button
    // reveals in batches client-side. limit>=30 triggers the backend score
    // floor → returns "all reasonably relevant", which is what we paginate.
    var isSiteSearch = onSiteSearchPage();
    if (isSiteSearch) limit = 48;
    var payload = {
      query: q, limit: limit,
      surface: isSiteSearch ? 'site' : 'product',  // which search page (analytics)
      session_id: sessionId()                       // anon distinct-visitor tag
    };
    if (IS_FBM() && !isSiteSearch) payload.types = ['product'];

    var t0 = performance.now();
    fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    })
      .then(function(r){ return r.json(); })
      .then(function(data){
        var tFetch = Math.round(performance.now() - t0);
        // Kill switch: backend says search is disabled → render nothing,
        // reveal native Miva results. Site-wide off switch, no redeploy.
        if (data.disabled) {
          var hs = document.getElementById('ff-ai-hide');
          if (hs) hs.remove();
          return;
        }
        injectHits(data.hits || [], data.ff_q, data.elapsed_ms);
        var tTotal = Math.round(performance.now() - t0);
        // Store debug info for console access via ffDebug()
        window._ffDebug = {
          version: VERSION,
          query: q, limit: limit, types: payload.types || 'all',
          backendMs: data.elapsed_ms, fetchMs: tFetch, renderMs: tTotal - tFetch,
          totalMs: tTotal, hitsReturned: (data.hits || []).length,
          hitsRendered: document.querySelectorAll('[data-ai-type]').length,
          ff_q: data.ff_q, isFBM: IS_FBM()
        };
        // Concise auto-summary so over-break console-watching shows each query
        // (build · query · count · total ms) without anyone typing ffDebug().
        console.info('[foamfactory-ai] ' + VERSION + ' · "' + q + '" · ' +
          window._ffDebug.hitsRendered + ' results · ' + tTotal + 'ms');
      })
      .catch(function(err){
        console.warn('[foamfactory-ai] search failed:', err);
        var hideStyle = document.getElementById('ff-ai-hide');
        if (hideStyle) hideStyle.remove();
      });
  }

  // Console debug command: type ffDebug() in browser console
  window.ffDebug = function() {
    if (!window._ffDebug) { console.log('[foamfactory-ai] no search has run yet'); return; }
    var d = window._ffDebug;
    console.log(
      '[foamfactory-ai] ' + (d.version || '?') + '  query="' + d.query + '"  limit=' + d.limit + '  types=' + d.types +
      '\n  backend: ' + d.backendMs + 'ms  fetch: ' + d.fetchMs + 'ms  render: ' + d.renderMs +
      'ms  total: ' + d.totalMs + 'ms' +
      '\n  hits returned: ' + d.hitsReturned + '  rendered: ' + d.hitsRendered +
      '  isFBM: ' + d.isFBM + '  ff_q: ' + d.ff_q
    );
    return d;
  };

  // One-line load banner (console only — invisible to shoppers). Confirms the
  // injector loaded on this page and which build, even before a search runs.
  console.info('[foamfactory-ai] injector ' + VERSION + ' · ' +
    (isCanadaSite() ? 'canada' : 'us') + ' · type ffDebug() for last-search timings');
  console.info('[foamfactory-ai] hand-built in macomb county 🧱');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
