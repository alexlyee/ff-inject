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
      location.pathname.indexOf('/product-search') !== -1) {
    var hideStyle = document.createElement('style');
    hideStyle.id = 'ff-ai-hide';
    hideStyle.textContent = '#js-product-list, section.x-product-list:not(.t-featured-products) { visibility: hidden; min-height: 200px; }';
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

  function onSearchPage(){
    // Miva's Friendly URLs feature rewrites the canonical
    // /mm5/merchant.mvc?Screen=SRCH&Search=... to /product-search.html?Search=...
    // so we have to recognize both. The storefront search box uses the friendly
    // form; only direct navigation hits the canonical form.
    return location.search.indexOf('Screen=SRCH') !== -1 ||
           location.pathname.indexOf('/product-search') !== -1;
  }

  function getQuery(){
    // Miva uses 'Search' (canonical/friendly URL) and 'search' (powrsrch form
    // submissions, pagination links). URLSearchParams.get() is case-sensitive.
    var p = new URLSearchParams(location.search);
    return (p.get('Search') || p.get('search') || '').trim();
  }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  }); }

  function appendTrackingParam(href, hash){
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

    var container;
    if (IS_FBM()) {
      // foambymail.com: product list is #js-product-list
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

    // On foambymail.com product search, show only products (the native page shows products only).
    // On Shadows/dev store, show all types with the banner.
    var filtered = IS_FBM() ? hits.filter(function(h){ return (h.type || 'product') === 'product'; }) : hits;

    if (!IS_FBM()) {
      var bannerClass = 'o-layout__item u-width-12 u-text-center u-font-small';
      var banner = document.createElement('div');
      banner.className = bannerClass;
      banner.style.cssText = 'padding:10px;background:#f7f9ff;border-left:3px solid #2d6cdf;margin-bottom:12px;color:#2d6cdf;';
      banner.textContent = 'AI-ranked results for "' + getQuery() + '" (' + hits.length + ' matches)';
      container.appendChild(banner);
    }
    filtered.forEach(function(h){
      var tmp = document.createElement('div');
      tmp.innerHTML = cardHTML(h, ffQ || '');
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

    fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query: q, limit: 20 }),
    })
      .then(function(r){ return r.json(); })
      .then(function(data){ injectHits(data.hits || [], data.ff_q); })
      .catch(function(err){
        console.warn('[foamfactory-ai] search failed:', err);
        // On failure, reveal native results so the page isn't blank
        var hideStyle = document.getElementById('ff-ai-hide');
        if (hideStyle) hideStyle.remove();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
