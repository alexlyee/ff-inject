/* Foam Factory AI Search — storefront DOM injector.
   Runs on every page via the head_tag resource group. On SRCH pages, fetches
   AI-ranked results from the Cloudflare-tunneled backend and replaces Miva's
   native product list with AI hits using Miva's own .x-product-list markup.
   Categories and Miva pages surface alongside products; each hit renders with
   a type badge so customers can tell products apart from categories apart from
   resource pages at a glance. */
(function(){
  var API = 'https://debian-rise-subscribers-schools.trycloudflare.com/search';

  // Immediately hide the native product list on search pages to prevent
  // flash of native content (FOUC) before AI results load. The CSS rule
  // is injected synchronously in <head>, so it takes effect before the
  // browser paints the body. injectHits() removes this after replacing.
  // Safety: a 4-second timeout removes the hide CSS if AI results never
  // arrive (backend down, JS error, param mismatch, etc.) so the page
  // is never permanently blank.
  if (location.search.indexOf('Screen=SRCH') !== -1 ||
      location.search.indexOf('Screen=SEARCH') !== -1 ||
      location.pathname.indexOf('/product-search') !== -1 ||
      location.pathname.indexOf('/search.html') !== -1) {
    var hideStyle = document.createElement('style');
    hideStyle.id = 'ff-ai-hide';
    hideStyle.textContent = '#js-product-list, section.x-product-list:not(.t-featured-products), .gsc-control-cse, #content-item { visibility: hidden; min-height: 200px; }';
    document.head.appendChild(hideStyle);
    setTimeout(function(){
      var s = document.getElementById('ff-ai-hide');
      if (s) { s.remove(); console.warn('[foamfactory-ai] timeout — revealing native results'); }
    }, 4000);
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

  var BADGE_STYLES = {
    product:  'background:#e7f0ff;color:#2d6cdf;',
    category: 'background:#fff1e4;color:#c46a1e;',
    page:     'background:#e9f6ea;color:#2e8c3b;',
  };
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
    // Square badge (border-radius:2px) to match foambymail.com's rectangular UI.
    var badgeCss = 'display:inline-block;padding:2px 8px;border-radius:2px;' +
      'font-size:11px;font-weight:600;letter-spacing:.02em;margin-right:8px;' +
      (BADGE_STYLES[type] || BADGE_STYLES.product);
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
    // Breadcrumb from hit.breadcrumb (plain text "Category > Subcategory > Name")
    var breadcrumb = hit.breadcrumb ? '<div style="font-size:12px;color:#888;margin-top:4px;font-family:ui-monospace,monospace;">' + esc(hit.breadcrumb).substring(0, 120) + '</div>' : '';
    var imgHTML = imgSrc && imgSrc !== PLACEHOLDER_URI
      ? '<a href="' + href + '" style="flex:0 0 80px;"><img src="' + imgSrc + '" alt="" loading="lazy" style="width:80px;height:80px;object-fit:cover;border-radius:4px;" onerror="this.parentNode.style.display=\'none\'"></a>'
      : '';
    return '' +
      '<div class="column whole" data-ai-rank="1" data-ai-type="' + esc(type) + '" style="padding:14px 0;border-bottom:1px solid #eee;display:flex;gap:14px;align-items:flex-start;">' +
        imgHTML +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">' +
            '<span style="' + badgeCss + '">' + esc(badgeText) + '</span>' +
            '<a href="' + href + '" style="font-weight:600;color:#2d6cdf;text-decoration:none;font-size:15px;">' + esc(hit.name) + '</a>' +
            (hit.code ? '<span style="font-family:monospace;font-size:13px;color:#888;">' + esc(hit.code) + '</span>' : '') +
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
      (BADGE_STYLES[type] || BADGE_STYLES.product);
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

  function injectHits(hits, ffQ){
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
      // Site search: show all types, exclude Canada-only on US site
      filtered = hits.filter(function(h){
        if (h.url_path && h.url_path.indexOf('canada.foambymail.com') !== -1) return false;
        return true;
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
    filtered.forEach(function(h){
      var tmp = document.createElement('div');
      tmp.innerHTML = cardFn(h, ffQ || '');
      container.appendChild(tmp.firstChild);
    });

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
        injectHits(data.hits || [], data.ff_q);
        return;
      } catch(e) { /* fall through to fetch */ }
    }

    // Read ProductsPerPage from URL (Miva's VIEW 12/24/All control).
    // 12 = default, 24 = expanded, 9999 = All. Empty/missing = 12.
    var urlParams = new URLSearchParams(location.search);
    var ppp = parseInt(urlParams.get('ProductsPerPage'), 10);
    var limit = (ppp > 0 && ppp < 9999) ? ppp : (ppp >= 9999 ? 100 : 12);

    // Product search: products only. Site search: all types.
    var payload = { query: q, limit: limit };
    var isSiteSearch = onSiteSearchPage();
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
        injectHits(data.hits || [], data.ff_q);
        var tTotal = Math.round(performance.now() - t0);
        // Store debug info for console access via ffDebug()
        window._ffDebug = {
          query: q, limit: limit, types: payload.types || 'all',
          backendMs: data.elapsed_ms, fetchMs: tFetch, renderMs: tTotal - tFetch,
          totalMs: tTotal, hitsReturned: (data.hits || []).length,
          hitsRendered: document.querySelectorAll('[data-ai-type]').length,
          ff_q: data.ff_q, isFBM: IS_FBM()
        };
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
      '[foamfactory-ai] query="' + d.query + '"  limit=' + d.limit + '  types=' + d.types +
      '\n  backend: ' + d.backendMs + 'ms  fetch: ' + d.fetchMs + 'ms  render: ' + d.renderMs +
      'ms  total: ' + d.totalMs + 'ms' +
      '\n  hits returned: ' + d.hitsReturned + '  rendered: ' + d.hitsRendered +
      '  isFBM: ' + d.isFBM + '  ff_q: ' + d.ff_q
    );
    return d;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
