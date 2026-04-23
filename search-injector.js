/* Foam Factory AI Search — storefront DOM injector.
   Runs on every page via the head_tag resource group. On SRCH pages, fetches
   AI-ranked results from the Tailscale-funneled backend and replaces Miva's
   native product list with AI hits using Miva's own .x-product-list markup. */
(function(){
  var API = 'https://a-foamfactory-workstation.tail1178b.ts.net/search';

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

  function onSearchPage(){
    // Screen=SRCH in the URL query string
    return location.search.indexOf('Screen=SRCH') !== -1;
  }

  function getQuery(){
    var p = new URLSearchParams(location.search);
    return (p.get('Search') || '').trim();
  }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  }); }

  function cardHTML(hit){
    var href = 'https://www.competitivefoam.com/mm5/merchant.mvc?Screen=PROD&Product_Code=' +
      encodeURIComponent(hit.code);
    var price = (hit.price && hit.price > 0) ? ('$' + Number(hit.price).toFixed(2)) : '';
    // Empty alt because the name is rendered right below in <strong> —
    // empty alt stops the duplicate-name fallback that broken src produces.
    return '' +
      '<div class="o-layout__item u-text-center x-product-list__item" data-ai-rank="1">' +
        '<a class="u-block x-product-list__link" href="' + href + '" title="' + esc(hit.name) + '">' +
          '<figure class="x-product-list__figure">' +
            '<img class="x-product-list__image" src="' + PLACEHOLDER_URI + '" alt="" loading="lazy" style="width:100%;height:auto;display:block;margin:0 auto" width="360" height="360">' +
            '<figcaption>' +
              '<strong class="x-product-list__name">' + esc(hit.name) + '</strong>' +
              (price ? '<span class="x-product-list__price">' + price + '</span>' : '') +
            '</figcaption>' +
          '</figure>' +
        '</a>' +
      '</div>';
  }

  function injectHits(hits){
    if (!hits || !hits.length) return;
    // Prefer an existing product-list section; if absent (no native results),
    // insert a new one after the main content heading.
    var container = document.querySelector('section.x-product-list:not(.t-featured-products)');
    if (!container) {
      // Replace the "No products matched" fallback if present
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
    // Banner so the customer knows this is AI-ranked
    var banner = document.createElement('div');
    banner.className = 'o-layout__item u-width-12 u-text-center u-font-small';
    banner.style.cssText = 'padding:10px;background:#f7f9ff;border-left:3px solid #2d6cdf;margin-bottom:12px;color:#2d6cdf;';
    banner.textContent = 'AI-ranked results for "' + getQuery() + '" (' + hits.length + ' matches)';
    container.appendChild(banner);
    hits.forEach(function(h){
      var tmp = document.createElement('div');
      tmp.innerHTML = cardHTML(h);
      container.appendChild(tmp.firstChild);
    });
  }

  function run(){
    if (!onSearchPage()) return;
    var q = getQuery();
    if (!q) return;
    fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query: q, limit: 20, types: ['product'] }),
    })
      .then(function(r){ return r.json(); })
      .then(function(data){ injectHits(data.hits || []); })
      .catch(function(err){ console.warn('[foamfactory-ai] search failed:', err); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
