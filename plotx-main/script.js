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

const AUTH_KEY = "px_admin_token";       // now stores the JWT, not just "true"
const LEADS_CACHE_KEY = "px_leads_cache"; // only used to avoid re-fetching leads every click
const DEFAULT_BANNER = "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=900&q=80";
const LISTING_POLL_MS = 10000;
const SETTINGS_POLL_MS = 15000;

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
  const res = await fetch(`${API_BASE}/api/posters?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load listings");
  cachedListings = await res.json();
  return cachedListings;
}

function getAllListings() {
  // Synchronous read of whatever was last fetched. Call fetchListings()
  // first (we  this on load and after every mutation) to keep it fresh.
  return cachedListings;
}

function authHeader() {
  const token = sessionStorage.getItem(AUTH_KEY);
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

/* ---------- NAVIGATION ---------- */
function goTo(target){
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
  await refreshAndRenderDirectory();
}
async function setSubcategoryFilter(value){
  currentSubcategory = value;
  currentCategory = "All Types";
  document.querySelectorAll("#subcategoryFilters .filter-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.subcategory === value);
  });
  await refreshAndRenderDirectory();
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
function badgeClass(purpose){
  return (purpose || "").replace(/\s+/g,"");
}
function buildCard(item){
  const isJV = item.purpose === "Joint Venture";
  const ratioBadge = isJV && item.landownerShare
    ? `<div class="badge-ratio">📊 Ratio: ${item.landownerShare}% Landowner / ${item.developerShare || (100-item.landownerShare)}% Developer</div>`
    : "";
  const priceLabel = isJV ? "DEAL TYPE:" : (item.purpose === "Rent" || item.purpose === "Lease" ? "RENTAL VALUE:" : "FINANCIAL MATRIX:");
 const img = item.image && item.image.trim()
  ? resolveAssetUrl(item.image)
  : "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80";
  const price = item.price || "0";
  const description = item.description || "";
  const features = item.features || [];

  return `
    <div class="listing-card" data-id="${item.id}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.title)}">
      <div class="listing-img-wrap">
        <img src="${img}" alt="${escapeHtml(item.title)}" onerror="this.src='${DEFAULT_BANNER}'">
        <span class="badge-purpose ${badgeClass(item.purpose)}">${(item.purpose||"").toUpperCase()}</span>
        <span class="badge-cat">${item.category || ""}</span>
        <span class="badge-id">ID: ${item.id}</span>
        ${ratioBadge}
      </div>
      <div class="listing-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="listing-loc">📍 ${escapeHtml(item.location)}</p>
        ${item.subcategory ? `<div class="listing-subcategory">${escapeHtml(item.subcategory)}</div>` : ""}
        <div class="listing-price-row">
          <span class="label">${priceLabel}</span>
          <span class="price">${price.match(/^[\d,]+$/) ? "₹"+price : price}</span>
        </div>
        <div class="listing-area">
          <span>📐 Total Area:</span><b>${item.area || 0} sqft</b>
        </div>
        <p class="listing-desc">${escapeHtml(description).slice(0,120)}${description.length>120?"...":""}</p>
        <div class="tag-row">
          ${features.map(f=>`<span class="feature-tag">• ${escapeHtml(f)}</span>`).join("")}
        </div>
        <div class="mobile-view-details">Tap to view full details</div>
        <div class="card-actions">
          <a href="tel:+919710918099" class="card-btn call-btn">📞 Call Agent</a>
          <button type="button" class="card-btn enquiry-btn" onclick="openEnquiry('${item.id}'); event.stopPropagation();">📩 Enquiry</button>
        </div>
      </div>
    </div>`;
}

/* ---------- LISTING DETAILS MODAL ---------- */
function openListingDetails(listingId){
  const item = getAllListings().find(l => l.id === listingId);
  if(!item) return;

  const img = item.image && item.image.trim() ? resolveAssetUrl(item.image) : DEFAULT_BANNER;
  const price = item.price || "0";
  const priceLabel = item.purpose === "Rent" || item.purpose === "Lease" ? "Rental Value" : (item.purpose === "Joint Venture" ? "Deal Type" : "Financial Matrix");
  const features = Array.isArray(item.features) ? item.features : [];

  document.getElementById("listingDetailsContent").innerHTML = `
    <div class="details-image-wrap">
      <img src="${img}" alt="${escapeHtml(item.title)}" onerror="this.src='${DEFAULT_BANNER}'">
      <span class="details-purpose">${escapeHtml((item.purpose || "").toUpperCase())}</span>
    </div>
    <div class="details-body">
      <div class="details-topline">
        <span class="details-id">ID: ${escapeHtml(item.id || "")}</span>
        ${item.category ? `<span class="details-category">${escapeHtml(item.category)}</span>` : ""}
      </div>
      <h2>${escapeHtml(item.title || "Property Details")}</h2>
      <p class="details-location">📍 ${escapeHtml(item.location || "Location not specified")}</p>
      ${item.subcategory ? `<div class="details-subcategory">${escapeHtml(item.subcategory)}</div>` : ""}
      <div class="details-price-row"><span>${priceLabel}</span><strong>${price.match(/^[\d,]+$/) ? "₹"+price : escapeHtml(price)}</strong></div>
      <div class="details-area"><span>📐 Total Area</span><strong>${escapeHtml(String(item.area || 0))} sqft</strong></div>
      ${item.description ? `<div class="details-section"><h4>Property Description</h4><p>${escapeHtml(item.description)}</p></div>` : ""}
      ${features.length ? `<div class="details-section"><h4>Features & Highlights</h4><div class="details-features">${features.map(f=>`<span>• ${escapeHtml(f)}</span>`).join("")}</div></div>` : ""}
      ${item.landownerShare ? `<div class="details-section"><h4>Joint Venture Ratio</h4><p>${escapeHtml(String(item.landownerShare))}% Landowner / ${escapeHtml(String(item.developerShare || (100-item.landownerShare)))}% Developer</p></div>` : ""}
      <div class="details-actions">
        <a href="tel:+919710918099" class="card-btn call-btn">📞 Call Agent</a>
        <button type="button" class="card-btn enquiry-btn" onclick="closeListingDetails(); openEnquiry('${item.id}')">📩 Enquiry</button>
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
  grid.addEventListener("click", (e)=>{
    if(e.target.closest("a, button")) return;
    const card = e.target.closest(".listing-card");
    if(card) openListingDetails(card.dataset.id);
  });
  grid.addEventListener("keydown", (e)=>{
    if(e.key !== "Enter" && e.key !== " ") return;
    if(e.target.closest("a, button")) return;
    const card = e.target.closest(".listing-card");
    if(card){ e.preventDefault(); openListingDetails(card.dataset.id); }
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
    await fetchListings(currentPurpose, currentCategory);
  } catch (err) {
    console.error(err);
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
   Logo is intentionally locked. Only the banner is editable.
====================================================== */
let siteSettingsCache = { logo: null, banner: null };

async function fetchSiteSettings(){
  try{
    const res = await fetch(`${API_BASE}/api/settings?t=${Date.now()}`, { cache: "no-store" });
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
  const fixedLogo = "assets/logo.svg";
  const headerImg = document.getElementById("headerLogoImg");
  const loginImg = document.getElementById("loginLogoImg");
  if(headerImg) headerImg.src = fixedLogo;
  if(loginImg) loginImg.src = fixedLogo;
}

function applyBanner(){
  const img = resolveAssetUrl(siteSettingsCache.banner) || DEFAULT_BANNER;
  const finalUrl = siteSettingsCache.banner && img.startsWith("http") ? `${img}${img.includes("?") ? "&" : "?"}v=${Date.now()}` : img;
  const hero = document.getElementById("heroBannerImg");
  const preview = document.getElementById("bannerPreviewImg");
  if(hero) hero.src = finalUrl;
  if(preview) preview.src = finalUrl;
}

let bannerFile = null;
const bannerInput = document.getElementById("bannerFileInput");
if(bannerInput){
  bannerInput.addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    bannerFile = file;
    const reader = new FileReader();
    reader.onload = ()=>{
      const preview = document.getElementById("bannerPreviewImg");
      if(preview) preview.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById("saveBannerBtn").addEventListener("click", async ()=>{
  if(!bannerFile){ alert("Please choose an image first."); return; }
  const fd = new FormData();
  fd.append("image", bannerFile);
  try{
    const res = await fetch(`${API_BASE}/api/admin/settings/banner`, {
      method: "POST",
      headers: authHeader(),
      body: fd
    });
    if (res.status === 401) { logoutAndShowLogin(); return; }
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    siteSettingsCache.banner = data.banner;
    applyBanner();
    bannerFile = null;
    if(bannerInput) bannerInput.value = "";
    const note = document.getElementById("bannerSavedNote");
    note.classList.remove("hidden");
    setTimeout(()=> note.classList.add("hidden"), 2500);
  }catch(err){
    console.error(err);
    alert("Could not save the banner image. Please try again.");
  }
});

document.getElementById("resetBannerBtn").addEventListener("click", async ()=>{
  try{
    const res = await fetch(`${API_BASE}/api/admin/settings/banner`, {
      method: "DELETE",
      headers: authHeader()
    });
    if (res.status === 401) { logoutAndShowLogin(); return; }
    if (!res.ok) throw new Error("Reset failed");
    siteSettingsCache.banner = null;
    bannerFile = null;
    if(bannerInput) bannerInput.value = "";
    applyBanner();
  }catch(err){
    console.error(err);
    alert("Could not reset the banner image. Please try again.");
  }
});

/* ======================================================
   ADMIN PANEL — LOGIN (now real JWT auth against the API)
====================================================== */
function isLoggedIn(){
  return !!sessionStorage.getItem(AUTH_KEY);
}

async function showAdminView(){
  if(isLoggedIn()){
    document.getElementById("adminLogin").classList.add("hidden");
    document.getElementById("adminDashboard").classList.remove("hidden");
    document.getElementById("dashboardLabel").textContent = "Dashboard";
    await renderManageList();
    await renderLeads();
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
document.getElementById("refreshContentBtn").addEventListener("click", renderManageList);

/* ---------- STAT CARDS ---------- */
let cachedLeads = [];

async function updateAdminStats(){
  const now = new Date();
  const thisMonthCount = cachedLeads.filter(l=>{
    const d = new Date(l.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  document.getElementById("statTotalLeads").textContent = cachedLeads.length;
  document.getElementById("statPosters").textContent = getAllListings().length;
  document.getElementById("statThisMonth").textContent = thisMonthCount;
}

/* ---------- RENDER LEADS TABLE (fetches from /api/admin/leads) ---------- */
async function renderLeads(){
  const tbody = document.getElementById("leadsTableBody");
  const note = document.getElementById("noLeadsNote");

  try {
    const res = await fetch(`${API_BASE}/api/admin/leads`, { headers: authHeader() });
    if (res.status === 401) { logoutAndShowLogin(); return; }
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
      <td>${escapeHtml(l.name)}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${escapeHtml(l.mobile)}</td>
      <td>${escapeHtml(l.interest)}</td>
      <td>${escapeHtml(l.service)}</td>
      <td>${escapeHtml(l.context)}</td>
      <td>${new Date(l.date).toLocaleDateString("en-IN")}</td>
    </tr>
  `).join("");
  await updateAdminStats();
}

function logoutAndShowLogin(){
  sessionStorage.removeItem(AUTH_KEY);
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
    sessionStorage.setItem(AUTH_KEY, data.token);
    await showAdminView();
  } catch (e) {
    console.error(e);
    err.textContent = "Could not reach the server. Please try again.";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", ()=>{
  sessionStorage.removeItem(AUTH_KEY);
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
  const count = getAllListings().length + 1;
  document.getElementById("f_id").value = `${prefix}-${type}-${count}`;
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

    alert("✅ Poster uploaded! It's now live on the Property Directory.");
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
      <div class="manage-item-info">
        <b>${escapeHtml(item.title)}</b>
        <span>${item.purpose} • ${item.category} • ID: ${item.id}</span>
      </div>
      <div class="manage-item-actions">
        <button class="btn-delete" onclick="deleteListing('${item.id}')">🗑 Delete</button>
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
    const fresh = await fetchListings(currentPurpose, currentCategory);
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
    const res = await fetch(`${API_BASE}/api/settings?t=${Date.now()}`, {cache:"no-store"});
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
window.addEventListener("focus", ()=>{ liveRefreshListings(); liveRefreshSettings(); });
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
  await refreshAndRenderDirectory();
  lastListingsSignature = JSON.stringify(cachedListings.map(x => [x.id, x.created_at, x.image, x.title, x.price]));
  recalcEstimator();
  refreshAutoPopulate();
  await fetchSiteSettings();
  lastSettingsSignature = JSON.stringify(siteSettingsCache);
  await showAdminView();
  generateNextId();
  updatePreview();
});
