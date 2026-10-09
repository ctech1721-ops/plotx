/* Plot X Realty: mandatory Get in Touch account flow.
   Show the form as soon as the site opens for visitors without an account.
   The server stores contact details in SiteUser for the admin Users tab;
   localStorage keeps the same browser signed into its account until Log out. */
(function () {
  const TOKEN = 'px_user_token';
  const PROFILE = 'px_user_profile';
  const $ = id => document.getElementById(id);
  const API_BASE = window.PLOTX_API_BASE || 'https://plotx-dmv2.onrender.com';
  const baseGoTo = window.goTo;

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(PROFILE) || 'null'); }
    catch (_) { return null; }
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="getInTouchModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="getInTouchTitle">
      <div class="modal-card get-in-touch-card">
        <span class="pill">PLOT X REALTY</span>
        <h3 id="getInTouchTitle">Get in Touch</h3>
        <p class="modal-sub">Share your details and our team can help you find the right property.</p>
        <form id="getInTouchForm" novalidate>
          <label for="gtName">Name *</label>
          <input id="gtName" name="name" type="text" placeholder="Your full name" autocomplete="name" maxlength="255" required>
          <label for="gtPhone">Phone number *</label>
          <input id="gtPhone" name="phone" type="tel" placeholder="10-digit mobile number" inputmode="numeric" autocomplete="tel-national" maxlength="14" required>
          <label for="gtEmail">Email <span class="optional-label">(optional)</span></label>
          <input id="gtEmail" name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="255">
          <button type="submit" id="getInTouchSubmit" class="gold-btn wide">Submit</button>
          <p id="getInTouchError" class="login-error" role="status" aria-live="polite"></p>
        </form>
        <p class="auth-note">Your details will be saved to your Plot X Realty account on this device.</p>
      </div>
    </div>`);

  function refreshAccountUI() {
    const user = currentUser();
    $('userLabel').textContent = 'Account';
    if (user) {
      $('acInitial').textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
      $('acName').textContent = 'Hi, ' + ((user.name || 'there').trim().split(/\s+/)[0]);
      $('acNameRow').textContent = user.name || '—';
      $('acPhone').textContent = user.phone ? (String(user.phone).startsWith('+') ? user.phone : '+91 ' + user.phone) : '—';
      $('acEmail').textContent = user.email || '—';
      const created = user.created || user.created_at;
      $('acSince').textContent = created ? new Date(created).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    } else {
      $('acInitial').textContent = 'U';
      $('acName').textContent = 'Your account';
      $('acNameRow').textContent = '—';
      $('acPhone').textContent = '—';
      $('acEmail').textContent = '—';
      $('acSince').textContent = '—';
    }
    if (typeof window.syncDashboardVisibility === 'function') window.syncDashboardVisibility();
  }

  function openForm() {
    $('getInTouchError').textContent = '';
    $('getInTouchModal').classList.remove('hidden');
    const user = currentUser();
    if (user) {
      $('gtName').value = user.name || '';
      $('gtPhone').value = user.phone || '';
      $('gtEmail').value = user.email || '';
    }
    setTimeout(() => $('gtName').focus(), 30);
  }
  // Replace any old sign-in routing: Account opens the account page or the contact form.
  window.goTo = function (target) {
    if (target === 'account' && !currentUser()) { openForm(); return; }
    if (typeof baseGoTo === 'function') baseGoTo(target);
  };
  $('userBtn').addEventListener('click', () => {
    if (currentUser()) window.goTo('account');
    else openForm();
  });
  // The required contact form cannot be dismissed: no close button, backdrop close, or Escape close.
  document.addEventListener('keydown', event => {
    if ($('getInTouchModal').classList.contains('hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'Tab') {
      const fields = Array.from($('getInTouchModal').querySelectorAll('input, button')).filter(el => !el.disabled);
      if (!fields.length) return;
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  $('gtPhone').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/[^\d+\s()-]/g, '').slice(0, 14);
  });

  $('getInTouchForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('gtName').value.trim();
    const phone = $('gtPhone').value.trim();
    const email = $('gtEmail').value.trim().toLowerCase();
    const button = $('getInTouchSubmit');
    const error = $('getInTouchError');
    error.textContent = '';
    if (!name) { error.textContent = 'Please enter your name.'; $('gtName').focus(); return; }
    const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) { error.textContent = 'Enter a valid 10-digit Indian mobile number.'; $('gtPhone').focus(); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { error.textContent = 'Enter a valid email address or leave it blank.'; $('gtEmail').focus(); return; }

    button.disabled = true;
    const oldLabel = button.textContent;
    button.textContent = 'Saving…';
    try {
      const response = await fetch(`${API_BASE}/api/users/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: digits, email }),
        signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save your details. Please try again.');
      if (data.token) localStorage.setItem(TOKEN, data.token);
      localStorage.setItem(PROFILE, JSON.stringify(data.user || { name, phone: digits, email, created: new Date().toISOString() }));
      refreshAccountUI();
      error.className = 'contact-success';
      error.textContent = 'Thank you! Your account is ready.';
      button.textContent = 'Saved';
      setTimeout(() => {
        $('getInTouchModal').classList.add('hidden');
        error.className = 'login-error';
        error.textContent = '';
        button.disabled = false;
        button.textContent = oldLabel;
      }, 1000);
    } catch (err) {
      error.className = 'login-error';
      error.textContent = err && err.message ? err.message : 'Connection problem. Please try again.';
      button.disabled = false;
      button.textContent = oldLabel;
    }
  });

  $('userLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(PROFILE);
    refreshAccountUI();
    if (typeof baseGoTo === 'function') baseGoTo('home');
  });

  const baseOpenEnquiry = window.openEnquiry;
  if (typeof baseOpenEnquiry === 'function') {
    window.openEnquiry = function (id) {
      baseOpenEnquiry(id);
      const user = currentUser();
      if (user) {
        if ($('e_name')) $('e_name').value = user.name || '';
        if ($('e_mobile')) $('e_mobile').value = user.phone || '';
        if ($('e_email')) $('e_email').value = user.email || '';
      }
    };
  }

  refreshAccountUI();
  // Show the mandatory contact form immediately on site entry for visitors without an account.
  if (!currentUser()) {
    window.setTimeout(() => {
      if (!currentUser()) openForm();
    }, 250);
  }
})();
