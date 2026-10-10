/* ======================================================
   PLOT X REALTY — MAIN SCRIPT (API-connected version)
   Listings, leads, admin auth, and site logo/banner all go
   through the Flask backend + SQL database now, so changes
   are visible to every visitor, not just the admin's browser.
====================================================== */

/* ---------- CONFIG ----------
   Change this to your deployed backend URL, e.g.
   "https://yourname.pythonanywhere.com"
   Leave as "" only if frontend + backend are served from the
   exact same domain (rare with Netlify + PythonAnywhere/Render).
*/
const API_BASE = "https://plotx-dmv2.onrender.com";

const AUTH_KEY = "px_admin_token";
/* Dashboard lock: the admin token lives in memory only (never saved in the browser),
   so reloading the page or leaving the dashboard locks it and the password is asked again. */
const adminSession = {
  t: null,
  getItem(){ return this.t; },
  setItem(k, v){ this.t = v; },
  removeItem(){ this.t = null; }
};
try{ localStorage.removeItem("px_admin_token"); }catch(e){}   // wipe tokens saved by older versions
const LEADS_CACHE_KEY = "px_leads_cache"; // only used to avoid re-fetching leads every click
const DEFAULT_BANNER = "assets/home-banner.jpg";
const FALLBACK_CARD_IMG = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=700&q=65";
const LISTINGS_CACHE_KEY = "px_listings_cache_v1";
const LISTING_POLL_MS = 45000;
const SETTINGS_POLL_MS = 90000;

/* Cloudinary can resize + compress on the fly. A 4000px phone photo becomes a
   ~60 KB image sized for the screen, so cards and property pages open fast. */
function optimizeImg(url, w){
  if(!url) return url;
  if(url.includes("res.cloudinary.com") && url.includes("/upload/") && !/\/upload\/[^/]*(f_auto|w_\d)/.test(url)){
    return url.replace("/upload/", `/upload/f_auto,q_auto:eco,w_${w},c_limit/`);
  }
  return url;
}

// Turns a relative "/uploads/xxx.jpg" path from the API into a full URL.
function resolveAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  return `${API_BASE}${path}`;
}

/* In-memory cache of listings fetched from the API.
   Many functions in this app (search, preview, autopopulate)
   expect a synchronous list, so we fetch once, cache here, and
   refresh this cache after every create/delete. */
let cachedListings = [];

async function fetchListings() {
  // Always keep one complete, fresh cache. Purpose/category filtering is done
  // locally so changing filters never throws away listings needed elsewhere.
  // "no-cache" = revalidate with the server's ETag (tiny 304 when nothing changed)
  const res = await fetch(`${API_BASE}/api/posters`, { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load listings");
  cachedListings = await res.json();
  try{ localStorage.setItem(LISTINGS_CACHE_KEY, JSON.stringify(cachedListings)); }catch(e){}
  return cachedListings;
}

function getAllListings() {
  // Synchronous read of whatever was last fetched. Call fetchListings()
  // first (we  this on load and after every mutation) to keep it fresh.
  return cachedListings;
}

function authHeader() {
  const token = adminSession.getItem(AUTH_KEY);
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

/* ---------- NAVIGATION ---------- */
function goTo(target){
  if(target !== "admin" && adminSession.t){ adminSession.removeItem(); }   // leaving dashboard = locked
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(target).classList.add("active");
  document.querySelectorAll(".nav-link").forEach(n => n.classList.remove("active"));
  const navBtn = document.querySelector(`.nav-link[data-target="${target}"]`);
  if(navBtn) navBtn.classList.add("active");
  window.scrollTo({top:0, behavior:"smooth"});
}

document.querySelectorAll(".nav-link").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    goTo(btn.dataset.target);
    closeMobileNav();
  });
});

/* Mobile hamburger menu — slides in as a side drawer with a dimmed
   backdrop (like a typical property-portal app menu). Only affects
   phone-width screens; on desktop the nav is always visible inline
   and none of this drawer styling applies (see CSS). */
const navToggleBtn = document.getElementById("navToggleBtn");
const mainNav = document.getElementById("mainNav");
const navDrawerBackdrop = document.getElementById("navDrawerBackdrop");
const navDrawerClose = document.getElementById("navDrawerClose");

function openMobileNav(){
  mainNav.classList.add("show");
  navDrawerBackdrop.classList.add("show");
}
function closeMobileNav(){
  mainNav.classList.remove("show");
  navDrawerBackdrop.classList.remove("show");
}
navToggleBtn.addEventListener("click", openMobileNav);
navDrawerClose.addEventListener("click", closeMobileNav);
navDrawerBackdrop.addEventListener("click", closeMobileNav);

document.getElementById("dashboardBtn").addEventListener("click", ()=>{
  goTo("admin");
  closeMobileNav();
});

document.querySelectorAll(".purpose-btn").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    // JOIN VENTURE is a dedicated service page, not a directory filter.
    if (btn.dataset.target === "jv") {
      goTo("jv");
      return;
    }

    goTo("home");
    currentCategory = "All Types";
    currentSubcategory = "All Sub Categories";
    document.querySelectorAll("#subcategoryFilters .filter-btn").forEach(b=>{
      b.classList.toggle("active", b.dataset.subcategory === "All Sub Categories");
    });
    await setPurposeFilter(btn.dataset.filter);
    document.querySelector(".directory-section")?.scrollIntoView({behavior:"smooth", block:"start"});
  });
});

/* ---------- DIRECTORY: FILTER STATE ---------- */
let currentPurpose = "All Listings";
let currentCategory = "All Types";
let currentSubcategory = "All Sub Categories";
let currentSearch = "";

async function setPurposeFilter(value){
  currentPurpose = value;
  document.querySelectorAll("#purposeFilters .filter-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.purpose === value);
  });
  renderDirectory();   // filtering is local — instant, no server call
}
async function setSubcategoryFilter(value){
  currentSubcategory = value;
  currentCategory = "All Types";
  document.querySelectorAll("#subcategoryFilters .filter-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.subcategory === value);
  });
  renderDirectory();
}

document.querySelectorAll("#purposeFilters .filter-btn").forEach(btn=>{
  btn.addEventListener("click", ()=> setPurposeFilter(btn.dataset.purpose));
});
document.querySelectorAll("#subcategoryFilters .filter-btn").forEach(btn=>{
  btn.addEventListener("click", ()=> setSubcategoryFilter(btn.dataset.subcategory));
});

/* Collapsible filter slicer — closed by default on desktop and mobile.
   Visitors open it only when they want to filter the directory. */
const filterToggleBtn = document.getElementById("filterToggleBtn");
const filterRow = document.getElementById("filterRow");
if (filterToggleBtn && filterRow) {
  filterToggleBtn.addEventListener("click", ()=>{
    const isOpen = filterRow.classList.toggle("show");
    filterToggleBtn.setAttribute("aria-expanded", String(isOpen));
    filterToggleBtn.innerHTML = isOpen
      ? '☰ Filters <span class="filter-chevron">▴</span>'
      : '☰ Filters <span class="filter-chevron">▾</span>';
  });
}

const searchInput = document.getElementById("searchInput");
if (searchInput) {
  // This is a property-search field, never an admin username field.
  // Keep it readonly until the visitor intentionally focuses it so Chrome
  // cannot restore the saved admin login into this input.
  const clearUnexpectedAutofill = () => {
    if (searchInput.value && searchInput.value.trim().toLowerCase() === "admin") {
      searchInput.value = "";
      currentSearch = "";
      renderDirectory();
    }
  };
  searchInput.value = "";
  currentSearch = "";
  searchInput.addEventListener("pointerdown", () => {
    searchInput.removeAttribute("readonly");
    clearUnexpectedAutofill();
  }, {once:true});
  searchInput.addEventListener("focus", () => {
    searchInput.removeAttribute("readonly");
    clearUnexpectedAutofill();
  });
  [0, 100, 300, 700, 1200, 2000].forEach(ms => setTimeout(clearUnexpectedAutofill, ms));
  // Some Chromium builds restore autofill after page scripts run. While the
  // field is still readonly, continuously reject any restored admin value.
  const autofillGuard = setInterval(() => {
    if (document.activeElement !== searchInput && searchInput.hasAttribute("readonly")) {
      if (searchInput.value) {
        searchInput.value = "";
        currentSearch = "";
      }
    } else if (document.activeElement === searchInput) {
      clearInterval(autofillGuard);
    }
  }, 250);
  searchInput.addEventListener("input", (e)=>{
    currentSearch = e.target.value.toLowerCase().trim();
    renderDirectory();
  });
}

/* ---------- BUILD LISTING CARD HTML ---------- */

function badgeClass(purpose) {
  const value = String(purpose || "").toLowerCase().trim();

  if (value === "sale") return "badge-sale";
  if (value === "rent") return "badge-rent";
  if (value === "lease") return "badge-lease";
  if (value === "joint venture") return "badge-jv";

  return "badge-default";
}

function buildCard(item){
  const features = Array.isArray(item.features)
    ? item.features
    : (typeof item.features === "string" && item.features.trim()
        ? item.features.split(",").map(f => f.trim()).filter(Boolean)
        : []);

  const isJV = item.purpose === "Joint Venture";

  const ratioBadge = isJV && item.landownerShare
    ? `<div class="badge-ratio">Ratio: ${item.landownerShare}% Landowner / ${item.developerShare || (100-item.landownerShare)}% Developer</div>`
    : "";

  const priceLabel = isJV
    ? "DEAL TYPE:"
    : (item.purpose === "Rent" || item.purpose === "Lease"
        ? "RENTAL VALUE:"
        : "FINANCIAL MATRIX:");

  const imagePath = item.image || item.image_url || "";
  const img = imagePath && imagePath.trim()
    ? optimizeImg(resolveAssetUrl(imagePath), 700)
    : FALLBACK_CARD_IMG;

  const price = String(item.price || item.price_range || "0");
  const description = item.description || "";

 
return `
  <div class="listing-card" data-id="${item.id}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.title)}">
    <div class="listing-img-wrap">
      <img src="${img}" alt="${escapeHtml(item.title)}" width="700" height="480" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_CARD_IMG}'">
      <span class="badge-purpose ${badgeClass(item.purpose)}">${(item.purpose || "").toUpperCase()}</span>
      <span class="badge-cat">${item.category || ""}</span>
      <span class="badge-id">ID: ${item.id}</span>
      ${ratioBadge}
    </div>

    <div class="listing-body">
      <h3>${escapeHtml(item.title)}</h3>
      <p class="listing-loc">${escapeHtml(item.location)}</p>
      ${item.subcategory ? `<div class="listing-subcategory">${escapeHtml(item.subcategory)}</div>` : ""}

      <div class="listing-price-row">
        <span class="label">${priceLabel}</span>
        <span class="price">${price.match(/^[\d,]+$/) ? "₹" + price : price}</span>
      </div>

      <div class="listing-area">
        <span>Total Area</span><b>${item.area || 0} sqft</b>
      </div>

      <div class="tag-row">
        ${features.map(f => `<span class="feature-tag">• ${escapeHtml(f)}</span>`).join("")}
      </div>

      <div class="card-actions">
        <button type="button" class="card-btn view-btn"
          onclick="event.preventDefault(); event.stopPropagation(); openListingDetails('${item.id}')">
          View Details
        </button>

        <a href="tel:+919710918099" class="card-btn call-btn">Call Agent</a>

        <button type="button" class="card-btn enquiry-btn"
          onclick="event.stopPropagation(); openEnquiry('${item.id}')">
          Enquiry
        </button>
      </div>
    </div>
  </div>`;
}

/* ---------- LISTING DETAILS MODAL ---------- */
function openListingDetails(listingId){
 
const item = getAllListings().find(
  l => String(l.id) === String(listingId)
);
if (!item) {
  console.error("Listing not found:", listingId);
  return;
}


  // Visitors can open property details without signing in.

const imagePath = item.image || item.image_url || "";
const img = imagePath && imagePath.trim()
  ? optimizeImg(resolveAssetUrl(imagePath), 1100)
  : DEFAULT_BANNER;
  
const price = String(item.price ?? item.price_range ?? item.priceRange ?? "0");

const location = item.location || item.locality || item.address || "Location not specified";

const area = item.area ?? item.total_area ?? item.totalArea ?? item.area_sqft ?? 0;

const priceLabel = item.purpose === "Rent" || item.purpose === "Lease"
  ? "Rental Value"
  : item.purpose === "Joint Venture"
    ? "Deal Type"
    : "Financial Matrix";

const features = Array.isArray(item.features) ? item.features : [];


  document.getElementById("listingDetailsContent").innerHTML = `
    <div class="details-image-wrap">
      <img src="${img}" alt="${escapeHtml(item.title)}" decoding="async" onerror="this.onerror=null;this.src='${DEFAULT_BANNER}'">
      <span class="details-purpose">${escapeHtml((item.purpose || "").toUpperCase())}</span>
    </div>
    <div class="details-body">
      <div class="details-topline">
        <span class="details-id">ID: ${escapeHtml(item.id || "")}</span>
        ${item.category ? `<span class="details-category">${escapeHtml(item.category)}</span>` : ""}
      </div>
      <h2>${escapeHtml(item.title || "Property Details")}</h2>
      <p class="details-location">${escapeHtml(location)}</p>
      ${item.subcategory ? `<div class="details-subcategory">${escapeHtml(item.subcategory)}</div>` : ""}
      <div class="details-price-row"><span>${priceLabel}</span><strong>${price.match(/^[\d,]+$/) ? "₹"+price : escapeHtml(price)}</strong></div>
      <div class="details-area"><span>Total Area</span><strong>${escapeHtml(String(area))} sqft</strong></div>
      ${item.description ? `<div class="details-section"><h4>Property Description</h4><p>${escapeHtml(item.description)}</p></div>` : ""}
      ${features.length ? `<div class="details-section"><h4>Features & Highlights</h4><div class="details-features">${features.map(f=>`<span>• ${escapeHtml(f)}</span>`).join("")}</div></div>` : ""}
      ${item.landownerShare ? `<div class="details-section"><h4>Joint Venture Ratio</h4><p>${escapeHtml(String(item.landownerShare))}% Landowner / ${escapeHtml(String(item.developerShare || (100-item.landownerShare)))}% Developer</p></div>` : ""}
      <div class="details-actions">
        <a href="tel:+919710918099" class="card-btn call-btn">Call Agent</a>
        <button type="button" class="card-btn enquiry-btn" onclick="closeListingDetails(); openEnquiry('${item.id}')">Enquiry</button>
      </div>
    </div>`;
  document.getElementById("listingDetailsModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeListingDetails(){
  document.getElementById("listingDetailsModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}


function bindListingCardClicks(){
  const grid = document.getElementById("listingGrid");
  if(!grid || grid.dataset.detailBound === "1") return;

  grid.dataset.detailBound = "1";

  grid.addEventListener("click", (e) => {
    const viewButton = e.target.closest(".view-btn, .view-details, .mobile-view-details");

    if (viewButton) {
      e.preventDefault();
      e.stopPropagation();

      const card = viewButton.closest(".listing-card");
      if (card) openListingDetails(card.dataset.id);

      return;
    }

    if (e.target.closest("a, button")) return;

    const card = e.target.closest(".listing-card");
    if (card) openListingDetails(card.dataset.id);
  });

  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("a, button")) return;

    const card = e.target.closest(".listing-card");
    if (card) {
      e.preventDefault();
      openListingDetails(card.dataset.id);
    }
  });
}


function initListingDetailsModal(){
  bindListingCardClicks();
  document.getElementById("listingDetailsClose")?.addEventListener("click", closeListingDetails);
  document.getElementById("listingDetailsModal")?.addEventListener("click", (e)=>{
    if(e.target.id === "listingDetailsModal") closeListingDetails();
  });
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closeListingDetails();
  });
}

initListingDetailsModal();

function escapeHtml(str){
  const d = document.createElement("div");
  d.innerText = str || "";
  return d.innerHTML;
}

/* ---------- RENDER DIRECTORY ---------- */
async function refreshAndRenderDirectory(){
  try {
    await fetchListings();
  } catch (err) {
    console.error(err);
    if(cachedListings.length){ renderDirectory(); return; }   // keep showing saved listings if offline
    document.getElementById("listingGrid").innerHTML =
      `<div class="no-results">Could not load listings. Please check your connection and try again.</div>`;
    return;
  }
  renderDirectory();
}

function renderDirectory(){
  const grid = document.getElementById("listingGrid");
  const all = getAllListings();

  const filtered = all.filter(item=>{
    const purposeOk = currentPurpose === "All Listings" || item.purpose === currentPurpose;
    const categoryOk = currentCategory === "All Types" || item.category === currentCategory;
    const subcategoryOk = currentSubcategory === "All Sub Categories" || (item.subcategory || "") === currentSubcategory;
    const searchOk = !currentSearch ||
      item.title.toLowerCase().includes(currentSearch) ||
      (item.location||"").toLowerCase().includes(currentSearch) ||
      (item.features||[]).join(" ").toLowerCase().includes(currentSearch) ||
      (item.subcategory||"").toLowerCase().includes(currentSearch);
    return purposeOk && categoryOk && subcategoryOk && searchOk;
  });

  document.getElementById("resultCount").textContent = filtered.length;

  if(filtered.length === 0){
    const msg = all.length === 0
      ? "No properties listed yet. Check back soon — new listings are posted regularly!"
      : "No matching properties found. Try adjusting your filters.";
    grid.innerHTML = `<div class="no-results">${msg}</div>`;
    return;
  }
  grid.innerHTML = filtered.map(buildCard).join("");
}

/* ======================================================
   JV SHARE ESTIMATOR (unchanged — pure client-side math)
====================================================== */
document.getElementById("jvCalcBtn").addEventListener("click", ()=>{
  const area = parseFloat(document.getElementById("jvArea").value) || 0;
  const guideline = parseFloat(document.getElementById("jvGuideline").value) || 0;
  const share = parseFloat(document.getElementById("jvShare").value) || 0;

  const landValue = area * guideline;
  const estimatedBuiltValue = landValue * 1.75;
  const landownerValue = estimatedBuiltValue * (share/100);
  const developerValue = estimatedBuiltValue * ((100-share)/100);

  document.getElementById("jvOutput").innerHTML = `
    <div class="out-row"><span>Raw Land Value</span><b>₹${formatINR(landValue)}</b></div>
    <div class="out-row"><span>Estimated Developed Value</span><b>₹${formatINR(estimatedBuiltValue)}</b></div>
    <div class="out-row"><span>Landowner Share (${share}%)</span><b>₹${formatINR(landownerValue)}</b></div>
    <div class="out-row"><span>Developer Share (${100-share}%)</span><b>₹${formatINR(developerValue)}</b></div>
    <div class="out-row out-total"><span>Total Project Value</span><span>₹${formatINR(estimatedBuiltValue)}</span></div>
  `;
});

/* ======================================================
   COST ESTIMATOR (unchanged — pure client-side math)
====================================================== */
const areaRange = document.getElementById("areaRange");
const areaNum = document.getElementById("areaNum");
const rateRange = document.getElementById("rateRange");
const rateNum = document.getElementById("rateNum");
let currentTier = 0.35;
let currentTierLabel = "Standard";

function formatINR(num){
  return Math.round(num).toLocaleString("en-IN");
}

function recalcEstimator(){
  const area = parseFloat(areaNum.value) || 0;
  const rate = parseFloat(rateNum.value) || 0;

  document.getElementById("areaVal").textContent = `${area.toLocaleString("en-IN")} SQ.FT.`;
  document.getElementById("rateVal").textContent = `₹${rate.toLocaleString("en-IN")} / SQFT`;

  const base = area * rate;
  const dev = base * currentTier;
  const reg = base * 0.09;
  const util = 75000;
  const total = base + dev + reg + util;

  document.getElementById("baseCalcDesc").textContent = `Calculated as: ${area.toLocaleString("en-IN")} sqft @ ₹${rate.toLocaleString("en-IN")}`;
  document.getElementById("baseCost").textContent = `₹${formatINR(base)}`;
  document.getElementById("devCost").textContent = `₹${formatINR(dev)}`;
  document.getElementById("tierLabel").textContent = currentTierLabel;
  document.getElementById("regCost").textContent = `₹${formatINR(reg)}`;
  document.getElementById("utilCost").textContent = `₹${formatINR(util)}`;
  document.getElementById("totalCost").textContent = `₹${formatINR(total)}`;
  document.getElementById("refId").textContent = `PX-${area}-${rate}`;
}

areaRange.addEventListener("input", ()=>{ areaNum.value = areaRange.value; recalcEstimator(); });
areaNum.addEventListener("input", ()=>{ areaRange.value = areaNum.value; recalcEstimator(); });
rateRange.addEventListener("input", ()=>{ rateNum.value = rateRange.value; recalcEstimator(); });
rateNum.addEventListener("input", ()=>{ rateRange.value = rateNum.value; recalcEstimator(); });

document.querySelectorAll("#tierBtns button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("#tierBtns button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentTier = parseFloat(btn.dataset.tier);
    currentTierLabel = btn.dataset.label;
    recalcEstimator();
  });
});

document.getElementById("resetEstimator").addEventListener("click", ()=>{
  areaNum.value = 1200; areaRange.value = 1200;
  rateNum.value = 1500; rateRange.value = 1500;
  document.querySelectorAll("#tierBtns button").forEach(b=>b.classList.remove("active"));
  document.querySelector('#tierBtns button[data-label="Standard"]').classList.add("active");
  currentTier = 0.35; currentTierLabel = "Standard";
  recalcEstimator();
});

function refreshAutoPopulate(){
  const select = document.getElementById("autoPopulate");
  select.innerHTML = `<option value="">Custom Entry (Enter details manually)</option>`;
  getAllListings().forEach(item=>{
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.title} (${item.area} sqft)`;
    select.appendChild(opt);
  });
}
document.getElementById("autoPopulate").addEventListener("change", (e)=>{
  if(!e.target.value) return;
  const item = getAllListings().find(l=>l.id === e.target.value);
  if(!item) return;
  const area = parseFloat(item.area) || 1200;
  const priceNum = parseFloat((item.price+"").replace(/[^\d]/g,"")) || 0;
  const rate = priceNum && area ? Math.round(priceNum/area) : 1500;
  areaNum.value = area; areaRange.value = Math.min(area,20000);
  rateNum.value = rate; rateRange.value = Math.min(rate,15000);
  recalcEstimator();
});

/* ======================================================
   ENQUIRY MODAL — now posts leads to the API
====================================================== */
function openEnquiry(listingId){
  const item = getAllListings().find(l => l.id === listingId);
  const modal = document.getElementById("enquiryModal");
  document.getElementById("enquiryForm").reset();
  document.getElementById("enquirySuccess").classList.add("hidden");
  document.getElementById("enquiryForm").classList.remove("hidden");

  if(item){
    document.getElementById("enquiryPropertyLine").textContent = `Regarding: ${item.title} (${item.purpose})`;
    document.getElementById("e_interest").value = item.title;
    document.getElementById("e_service").value = item.purpose;
  }else{
    document.getElementById("enquiryPropertyLine").textContent = "Regarding: General Enquiry";
    document.getElementById("e_interest").value = "General Enquiry";
    document.getElementById("e_service").value = "General";
  }
  modal.classList.remove("hidden");
}
function closeEnquiry(){
  document.getElementById("enquiryModal").classList.add("hidden");
}
document.getElementById("enquiryClose").addEventListener("click", closeEnquiry);
document.getElementById("enquiryModal").addEventListener("click", (e)=>{
  if(e.target.id === "enquiryModal") closeEnquiry();
});

document.getElementById("enquiryForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const lead = {
    name: document.getElementById("e_name").value.trim(),
    email: document.getElementById("e_email").value.trim() || "—",
    mobile: document.getElementById("e_mobile").value.trim(),
    interest: document.getElementById("e_interest").value,
    service: document.getElementById("e_service").value,
    context: document.getElementById("e_message").value.trim() || "—"
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead)
    });
    if (!res.ok) throw new Error("Lead submit failed");

    document.getElementById("enquiryForm").classList.add("hidden");
    document.getElementById("enquirySuccess").classList.remove("hidden");
    setTimeout(closeEnquiry, 1800);
  } catch (err) {
    console.error(err);
    alert("Sorry, something went wrong submitting your enquiry. Please try again or call us directly.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* ======================================================
   SITE LOGO + HOMEPAGE HERO BANNER
   Logo and homepage banner are locked to packaged assets.
   To change the homepage banner, replace assets/home-banner.jpg
   and redeploy the site.
====================================================== */
let siteSettingsCache = { logo: null, banner: null };

async function fetchSiteSettings(){
  try{
    const res = await fetch(`${API_BASE}/api/settings`, { cache: "no-cache" });
    if(!res.ok) throw new Error("Could not load settings");
    siteSettingsCache = await res.json();
  }catch(err){
    console.error(err);
    siteSettingsCache = { logo: null, banner: null };
  }
  applyLogo();
  applyBanner();
}

function applyLogo(){
  // Locked logo: always use the packaged asset, never a database-uploaded logo.
  const fixedLogo = "assets/logo.webp";
  const headerImg = document.getElementById("headerLogoImg");
  const loginImg = document.getElementById("loginLogoImg");
  if(headerImg) headerImg.src = fixedLogo;
  if(loginImg) loginImg.src = fixedLogo;
}

function applyBanner(){
  // Locked to the local asset. Replace assets/home-banner.jpg to change it.
  const hero = document.getElementById("heroBannerImg");
  if(hero) hero.src = DEFAULT_BANNER;
}

/* ======================================================
   ADMIN PANEL — LOGIN (now real JWT auth against the API)
====================================================== */
function isLoggedIn(){
  const t = adminSession.getItem(AUTH_KEY);
  if(!t) return false;
  try{ // drop a token the server would reject anyway
    const exp = JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).exp;
    if(exp && exp*1000 < Date.now()){ adminSession.removeItem(AUTH_KEY); return false; }
  }catch(e){}
  return true;
}

async function showAdminView(){
  if(isLoggedIn()){
    document.getElementById("adminLogin").classList.add("hidden");
    document.getElementById("adminDashboard").classList.remove("hidden");
    document.getElementById("dashboardLabel").textContent = "Dashboard";
    renderManageList();
    await Promise.all([renderLeads(), renderUsers()]);
    await updateAdminStats();
    updatePreview();
    generateNextId();
    switchAdminTab("leadsTab");
  }else{
    document.getElementById("adminLogin").classList.remove("hidden");
    document.getElementById("adminDashboard").classList.add("hidden");
  }
}

function switchAdminTab(tabId){
  document.querySelectorAll(".admin-subview").forEach(v => v.classList.add("hidden"));
  document.getElementById(tabId).classList.remove("hidden");
  document.querySelectorAll(".admin-tab").forEach(b=>{
    b.classList.toggle("active", b.dataset.admintab === tabId);
  });
}
document.querySelectorAll(".admin-tab").forEach(btn=>{
  btn.addEventListener("click", ()=> switchAdminTab(btn.dataset.admintab));
});
document.getElementById("refreshLeadsBtn").addEventListener("click", renderLeads);
document.getElementById("refreshUsersBtn").addEventListener("click", renderUsers);
document.getElementById("refreshContentBtn").addEventListener("click", renderManageList);

/* ---------- STAT CARDS ---------- */
let cachedLeads = [];
let cachedUsers = [];

async function updateAdminStats(){
  const now = new Date();
  const thisMonthCount = cachedLeads.filter(l=>{
    const d = new Date(l.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  document.getElementById("statTotalLeads").textContent = cachedLeads.length;
  document.getElementById("statPosters").textContent = getAllListings().length;
  document.getElementById("statThisMonth").textContent = thisMonthCount;
  document.getElementById("statUsers").textContent = cachedUsers.length;
}

/* ---------- RENDER LEADS TABLE (fetches from /api/admin/leads) ---------- */
async function renderLeads(){
  const tbody = document.getElementById("leadsTableBody");
  const note = document.getElementById("noLeadsNote");

  try {
    const res = await fetch(`${API_BASE}/api/admin/leads`, { headers: authHeader() });
   
if (res.status === 401) {
  console.error("Admin leads API returned 401. Token rejected by backend.");
  note.textContent = "Authentication failed while loading leads. Check the backend logs.";
  note.classList.remove("hidden");
  return;
}
    if (!res.ok) throw new Error("Failed to load leads");
    cachedLeads = await res.json();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = "";
    note.textContent = "Could not load leads. Please try again.";
    note.classList.remove("hidden");
    return;
  }

  if(cachedLeads.length === 0){
    tbody.innerHTML = "";
    note.textContent = "No leads yet.";
    note.classList.remove("hidden");
    await updateAdminStats();
    return;
  }
  note.classList.add("hidden");
  tbody.innerHTML = cachedLeads.map(l => `
    <tr>
      <td data-label="Name">${escapeHtml(l.name)}</td>
      <td data-label="Email">${escapeHtml(l.email)}</td>
      <td data-label="Mobile">${escapeHtml(l.mobile)}</td>
      <td data-label="Interest">${escapeHtml(l.interest)}</td>
      <td data-label="Service">${escapeHtml(l.service)}</td>
      <td data-label="Message">${escapeHtml(l.context)}</td>
      <td data-label="Date">${fmtDateTime(l.date)}</td>
    </tr>
  `).join("");
  await updateAdminStats();
}


/* ---------- RENDER USERS TABLE (everyone who created an account / signed in) ---------- */
function fmtDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");   // server stores UTC
  return d.toLocaleString("en-IN", {day:"numeric", month:"short", year:"numeric", hour:"numeric", minute:"2-digit"});
}
async function renderUsers(){
  const tbody = document.getElementById("usersTableBody");
  const note = document.getElementById("noUsersNote");
  try {
    const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeader() });
   
if (res.status === 401) {
  console.error("Admin users API returned 401. Token rejected by backend.");
  note.textContent = "Authentication failed while loading users. Check the backend logs.";
  note.classList.remove("hidden");
  return;
}
    if (!res.ok) throw new Error("Failed to load users");
    cachedUsers = await res.json();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = "";
    note.textContent = "Could not load users. Please try again.";
    note.classList.remove("hidden");
    return;
  }
  document.getElementById("userCountLabel").textContent = cachedUsers.length;
  if(cachedUsers.length === 0){
    tbody.innerHTML = "";
    note.textContent = "No Get in Touch submissions yet.";
    note.classList.remove("hidden");
    await updateAdminStats();
    return;
  }
  note.classList.add("hidden");
  tbody.innerHTML = cachedUsers.map(u => {
    const phone = String(u.phone || "");
    const tel = phone.startsWith("+") ? phone : `+91${phone}`;
    return `
    <tr>
      <td data-label="Name">${escapeHtml(u.name || "—")}</td>
      <td data-label="Mobile">${phone ? `<a href="tel:${escapeHtml(tel)}">${escapeHtml(phone.startsWith("+") ? phone : "+91 " + phone)}</a>` : "—"}</td>
      <td data-label="Email">${escapeHtml(u.email||"—")}</td>
      <td data-label="Joined">${fmtDateTime(u.created || u.created_at)}</td>
    </tr>`;
  }).join("");
  await updateAdminStats();
}

function logoutAndShowLogin(){
  adminSession.removeItem(AUTH_KEY);
  showAdminView();
  const err = document.getElementById("loginError");
  if (err) err.textContent = "Your session expired. Please log in again.";
}

document.getElementById("loginBtn").addEventListener("click", async ()=>{
  const u = document.getElementById("adminUser").value.trim();
  const p = document.getElementById("adminPass").value.trim();
  const err = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  err.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "Invalid username or password. Please try again.";
      return;
    }
    adminSession.setItem(AUTH_KEY, data.token);
    document.getElementById("adminPass").value = "";
    await showAdminView();
    resetIdleLock();
  } catch (e) {
    console.error(e);
    err.textContent = "Could not reach the server. Please try again.";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", ()=>{
  adminSession.removeItem(AUTH_KEY);
  showAdminView();
});

/* ======================================================
   ADMIN PANEL — POST FORM (now uploads to the API via FormData)
====================================================== */
const purposeSelect = document.getElementById("f_purpose");
purposeSelect.addEventListener("change", ()=>{
  const isJV = purposeSelect.value === "Joint Venture";
  document.getElementById("jvRatioRow").classList.toggle("hidden", !isJV);
  document.getElementById("priceLabel").textContent = isJV ? "Deal Type (e.g. Collaboration Deal)" : "Price (₹) *";
});

function generateNextId(){
  const purpose = purposeSelect.value;
  const category = document.getElementById("f_category").value;
  const prefix = category.slice(0,3).toLowerCase();
  const type = purpose === "Joint Venture" ? "jv" : purpose.toLowerCase();
  // highest existing number + 1, so IDs stay unique even after deleting posts
  const used = new Set(getAllListings().map(l => String(l.id)));
  let n = getAllListings().reduce((m,l)=>Math.max(m, parseInt((String(l.id).match(/(\d+)$/)||[0,0])[1],10) || 0), 0) + 1;
  while(used.has(`${prefix}-${type}-${n}`)) n++;
  document.getElementById("f_id").value = `${prefix}-${type}-${n}`;
}
document.getElementById("f_purpose").addEventListener("change", generateNextId);
document.getElementById("f_category").addEventListener("change", generateNextId);

const formFields = ["f_title","f_location","f_purpose","f_category","f_subcategory","f_price","f_area","f_desc","f_features"];
formFields.forEach(id=>{
  document.getElementById(id).addEventListener("input", updatePreview);
  document.getElementById(id).addEventListener("change", updatePreview);
});

let draftImageBase64 = "";
let draftImageFile = null;
document.getElementById("f_image").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  draftImageFile = file || null;
  if(!file) { draftImageBase64 = ""; updatePreview(); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    draftImageBase64 = reader.result; // used only for the live preview card
    updatePreview();
  };
  reader.readAsDataURL(file);
});

function buildDraftItem(){
  return {
    id: document.getElementById("f_id").value || "preview-id",
    title: document.getElementById("f_title").value || "Your Property Title",
    location: document.getElementById("f_location").value || "Location, City",
    purpose: document.getElementById("f_purpose").value,
    category: document.getElementById("f_category").value,
    price: document.getElementById("f_price").value || "0",
    area: document.getElementById("f_area").value || "0",
    description: document.getElementById("f_desc").value || "Property description will appear here...",
    features: (document.getElementById("f_features").value || "").split(",").map(s=>s.trim()).filter(Boolean),
    image: draftImageBase64,
    cleared: document.getElementById("f_cleared").value,
    subcategory: document.getElementById("f_subcategory").value,
    landownerShare: document.getElementById("f_landownerShare").value,
    developerShare: document.getElementById("f_developerShare").value
  };
}

function updatePreview(){
  const cardHtml = buildCard(buildDraftItem());
  const innerHtml = cardHtml.replace(/^\s*<div class="listing-card"[^>]*>/, "").replace(/<\/div>\s*$/, "");
  document.getElementById("previewCard").innerHTML = innerHtml;
}

document.getElementById("listingForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  if(!document.getElementById("f_id").value || document.getElementById("f_id").value === "preview-id") generateNextId();

  const fd = new FormData();
  fd.append("custom_id", document.getElementById("f_id").value);
  fd.append("title", document.getElementById("f_title").value);
  fd.append("location", document.getElementById("f_location").value);
  fd.append("purpose", document.getElementById("f_purpose").value);
  fd.append("category", document.getElementById("f_category").value);
  fd.append("sub_category", document.getElementById("f_subcategory").value);
  fd.append("price", document.getElementById("f_price").value);
  fd.append("area", document.getElementById("f_area").value);
  fd.append("description", document.getElementById("f_desc").value);
  fd.append("features", document.getElementById("f_features").value);
  fd.append("cleared", document.getElementById("f_cleared").value);
  fd.append("landowner_share", document.getElementById("f_landownerShare").value);
  fd.append("developer_share", document.getElementById("f_developerShare").value);
  if (draftImageFile) fd.append("image", draftImageFile);

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/admin/posters`, {
      method: "POST",
      headers: authHeader(), // do NOT set Content-Type manually — browser sets the multipart boundary
      body: fd
    });
    if (res.status === 401) { logoutAndShowLogin(); return; }
    if (!res.ok) throw new Error("Upload failed");

    e.target.reset();
    draftImageBase64 = "";
    draftImageFile = null;
    document.getElementById("jvRatioRow").classList.add("hidden");
    document.getElementById("priceLabel").textContent = "Price (₹) *";

    await res.json();
    await fetchListings();
    generateNextId();
    updatePreview();
    await renderManageList();
    renderDirectory();
    refreshAutoPopulate();
    await updateAdminStats();

    alert("Poster uploaded! It's now live on the Property Directory.");
  } catch (err) {
    console.error(err);
    alert("Sorry, the upload failed. Please check your connection and try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* ---------- MANAGE / DELETE LISTINGS ---------- */
async function renderManageList(){
  const wrap = document.getElementById("manageList");
  const all = getAllListings();
  document.getElementById("mgCount").textContent = all.length;

  if(all.length === 0){
    wrap.innerHTML = `<p class="empty-note">No listings posted yet. Use the form to add your first property.</p>`;
    return;
  }
  wrap.innerHTML = all.map(item=>`
    <div class="manage-item">
      <img class="manage-thumb" src="${item.image ? optimizeImg(resolveAssetUrl(item.image), 160) : FALLBACK_CARD_IMG}" alt="" width="64" height="64" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_CARD_IMG}'">
      <div class="manage-item-info">
        <b>${escapeHtml(item.title)}</b>
        <span>${item.purpose} • ${item.category} • ID: ${item.id}</span>
      </div>
      <div class="manage-item-actions">
        <button class="btn-delete" onclick="deleteListing('${item.db_id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

async function deleteListing(id){
  if(!confirm("Delete this listing? This cannot be undone.")) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/posters/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeader()
    });
    if (res.status === 401) { logoutAndShowLogin(); return; }
    if (!res.ok) throw new Error("Delete failed");

    await fetchListings();
    await renderManageList();
    renderDirectory();
    refreshAutoPopulate();
    await updateAdminStats();
  } catch (err) {
    console.error(err);
    alert("Could not delete this listing. Please try again.");
  }
}

/* ======================================================
   LIVE REFRESH — no manual browser refresh required
   Other visitors see newly posted listings/settings automatically.
====================================================== */
let lastListingsSignature = "";
let lastSettingsSignature = "";

async function liveRefreshListings(){
  try{
    if(document.visibilityState !== "visible") return;
    const fresh = await fetchListings();
    const signature = JSON.stringify(fresh.map(x => [x.id, x.created_at, x.image, x.title, x.price]));
    if(signature !== lastListingsSignature){
      lastListingsSignature = signature;
      renderDirectory();
      refreshAutoPopulate();
      if(isLoggedIn()){
        await renderManageList();
        await updateAdminStats();
      }
    }
  }catch(err){
    console.warn("Live listing refresh failed", err);
  }
}

async function liveRefreshSettings(){
  try{
    if(document.visibilityState !== "visible") return;
    const res = await fetch(`${API_BASE}/api/settings`, {cache:"no-cache"});
    if(!res.ok) return;
    const fresh = await res.json();
    const signature = JSON.stringify(fresh);
    if(signature !== lastSettingsSignature){
      lastSettingsSignature = signature;
      siteSettingsCache = fresh;
      applyLogo();
      applyBanner();
    }
  }catch(err){
    console.warn("Live settings refresh failed", err);
  }
}

setInterval(liveRefreshListings, LISTING_POLL_MS);
setInterval(liveRefreshSettings, SETTINGS_POLL_MS);
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "visible"){
    liveRefreshListings();
    liveRefreshSettings();
  }
});

/* ======================================================
   INIT
====================================================== */
document.addEventListener("DOMContentLoaded", async ()=>{
  // 1) paint the last-seen listings immediately (no waiting for a sleeping server)
  try{
    const saved = JSON.parse(localStorage.getItem(LISTINGS_CACHE_KEY) || "null");
    if(Array.isArray(saved) && saved.length){ cachedListings = saved; renderDirectory(); refreshAutoPopulate(); }
  }catch(e){}
  // 2) fetch listings + settings in parallel instead of one after the other
  fetchSiteSettings();
  await refreshAndRenderDirectory();
  lastListingsSignature = JSON.stringify(cachedListings.map(x => [x.id, x.created_at, x.image, x.title, x.price]));
  recalcEstimator();
  refreshAutoPopulate();
  lastSettingsSignature = JSON.stringify(siteSettingsCache);
  await showAdminView();
  generateNextId();
  updatePreview();
});


/* ---- Extra dashboard lock: Enter key + auto-lock after 10 min idle ---- */
document.getElementById("adminPass").addEventListener("keydown", e=>{
  if(e.key === "Enter"){ e.preventDefault(); document.getElementById("loginBtn").click(); }
});
let idleTimer = null;
const IDLE_LOCK_MS = 10 * 60 * 1000;
function resetIdleLock(){
  clearTimeout(idleTimer);
  if(!adminSession.t) return;
  idleTimer = setTimeout(()=>{
    adminSession.removeItem(AUTH_KEY);
    showAdminView();
    const err = document.getElementById("loginError");
    if(err) err.textContent = "Locked after 10 minutes of inactivity. Enter the password again.";
  }, IDLE_LOCK_MS);
}
["click","keydown","mousemove","touchstart"].forEach(ev=>
  document.addEventListener(ev, ()=>{ if(adminSession.t) resetIdleLock(); }, {passive:true}));
