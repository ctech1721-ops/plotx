/* Plot X Realty authentication.
   SMS OTP uses Firebase Phone Auth directly in the browser, so it does not wait
   for the Render backend to wake up. Email OTP keeps the existing backend flow. */
(function(){
  const TOKEN='px_user_token',PROFILE='px_user_profile',$=id=>document.getElementById(id);
  const cur=()=>{try{return localStorage.getItem(TOKEN)?JSON.parse(localStorage.getItem(PROFILE)):null}catch(e){return null}};
  let pendingAction=null, confirmationResult=null, recaptchaVerifier=null;

  const firebaseReady=()=>{
    const c=window.PLOTX_FIREBASE_CONFIG||{};
    return !!(window.firebase && c.apiKey && !String(c.apiKey).startsWith('PASTE_') && c.projectId && !String(c.projectId).startsWith('PASTE_'));
  };
  function firebaseInit(){
    if(!firebaseReady()) return false;
    try{
      if(!firebase.apps.length) firebase.initializeApp(window.PLOTX_FIREBASE_CONFIG);
      firebase.auth().languageCode='en';
      return true;
    }catch(e){ console.error('Firebase init failed',e); return false; }
  }
  firebaseInit();

  const baseGoTo=window.goTo;
  document.body.insertAdjacentHTML('beforeend',`<div id="otpModal" class="modal-overlay hidden"><div class="modal-card otp-card">
    <button type="button" id="otpClose" class="otp-x" aria-label="Close">&times;</button>
    <h3 id="otpTitle">Sign in</h3><p class="otp-sub" id="otpSub">Choose mobile or email. We will send you a one-time code.</p>
    <form id="otpStep1"><input id="o_name" placeholder="Full name" autocomplete="name" required>
      <select id="o_channel"><option value="sms">📱 Mobile number — SMS OTP</option><option value="email">📧 Email — Email OTP</option></select>
      <div id="o_phoneWrap"><input id="o_phone" placeholder="10-digit mobile number" inputmode="numeric" maxlength="10" autocomplete="tel-national"></div>
      <div id="o_emailWrap" class="hidden"><input id="o_email" type="email" placeholder="Email address" autocomplete="email"></div>
      <div id="firebaseRecaptcha" aria-hidden="true"></div>
      <button type="submit" class="gold-btn" id="o_send">Send OTP</button></form>
    <form id="otpStep2" class="hidden"><input id="o_code" placeholder="Enter 6-digit OTP" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required>
      <button type="submit" class="gold-btn" id="o_verify">Verify &amp; Sign in</button><button type="button" class="otp-link" id="o_back">Change mobile/email</button></form>
    <p id="otpErr" class="otp-err"></p></div></div>`);

  function refreshUI(){
    const u=cur();
    $('userLabel').textContent=u?u.name.split(' ')[0]:'Sign in';
    if(u){$('acInitial').textContent=(u.name||'U')[0].toUpperCase();$('acName').textContent='Hi, '+u.name.split(' ')[0];$('acNameRow').textContent=u.name;$('acPhone').textContent=u.phone?'+91 '+u.phone:(u.email||'—');$('acSince').textContent=new Date(u.created).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});}
    if(typeof syncDashboardVisibility==='function')syncDashboardVisibility();
  }
  function updateFields(){
    const email=$('o_channel').value==='email';
    $('o_phoneWrap').classList.toggle('hidden',email);$('o_emailWrap').classList.toggle('hidden',!email);
    $('o_phone').required=!email;$('o_email').required=email;
  }
  function clearRecaptcha(){
    try{ if(recaptchaVerifier) recaptchaVerifier.clear(); }catch(e){}
    recaptchaVerifier=null;
    const el=$('firebaseRecaptcha'); if(el) el.innerHTML='';
  }
  function reset(message){
    confirmationResult=null;clearRecaptcha();
    $('otpTitle').textContent=message?'Sign in to continue':'Sign in';
    $('otpSub').textContent=message||'Choose mobile or email. We will send you a one-time code.';
    $('otpStep1').reset();$('otpStep2').reset();$('otpStep1').classList.remove('hidden');$('otpStep2').classList.add('hidden');$('otpErr').textContent='';updateFields();
  }
  const open=message=>{reset(message);$('otpModal').classList.remove('hidden');};
  const close=()=>{$('otpModal').classList.add('hidden');clearRecaptcha();};
  window.requireUserSignIn=after=>{if(cur()){if(typeof after==='function')after();return true;}pendingAction=typeof after==='function'?after:null;open('Please sign in first. After OTP verification, the selected property will open automatically.');return false;};
  window.goTo=t=>{if(t==='account'&&!cur()){open();return;}baseGoTo(t);};
  $('userBtn').addEventListener('click',()=>cur()?window.goTo('account'):open());
  $('otpClose').onclick=close;$('o_back').onclick=()=>reset();$('o_channel').onchange=updateFields;
  $('o_phone').oninput=e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,10);

  function firebaseErrorMessage(err){
    const code=err&&err.code||'';
    const map={
      'auth/invalid-phone-number':'Please enter a valid 10-digit mobile number.',
      'auth/too-many-requests':'Too many attempts. Please wait a little and try again.',
      'auth/quota-exceeded':'SMS limit reached temporarily. Please try again later.',
      'auth/captcha-check-failed':'Verification failed. Please try Send OTP again.',
      'auth/network-request-failed':'Network problem. Please try again.',
      'auth/operation-not-allowed':'Firebase Phone Sign-in is not enabled yet.',
      'auth/unauthorized-domain':'This website domain is not added to Firebase Authorized domains.'
    };
    return map[code] || (err&&err.message ? err.message.replace(/^Firebase:\s*/,'') : 'Could not send OTP. Please try again.');
  }

  async function setupRecaptcha(){
    if(!firebaseInit()) throw new Error('Firebase is not configured. Add the Firebase Web App config in firebase-config.js.');
    if(recaptchaVerifier) return recaptchaVerifier;
    recaptchaVerifier=new firebase.auth.RecaptchaVerifier('firebaseRecaptcha',{
      size:'invisible',
      callback:()=>{},
      'expired-callback':()=>{clearRecaptcha();}
    });
    await recaptchaVerifier.render();
    return recaptchaVerifier;
  }

  async function saveFirebaseUser(user,name,channel,contact){
    const displayName=(name||user.displayName||'Plot X User').trim();
    if(displayName && user.displayName!==displayName){try{await user.updateProfile({displayName});}catch(e){}}
    const token=await user.getIdToken(true);
    const profile={
      name:displayName,
      phone:user.phoneNumber ? user.phoneNumber.replace(/^\+91/,'') : (channel==='sms'?contact:''),
      email:user.email|| (channel==='email'?contact:''),
      created:new Date().toISOString(),
      firebaseUid:user.uid
    };
    localStorage.setItem(TOKEN,token);localStorage.setItem(PROFILE,JSON.stringify(profile));
    refreshUI();
  }

  async function sendFirebaseSms(){
    const phone=$('o_phone').value.trim();
    if(!/^[6-9]\d{9}$/.test(phone)){ $('otpErr').textContent='Enter a valid 10-digit Indian mobile number.'; return; }
    const verifier=await setupRecaptcha();
    confirmationResult=await firebase.auth().signInWithPhoneNumber('+91'+phone,verifier);
    $('otpStep1').classList.add('hidden');$('otpStep2').classList.remove('hidden');
    $('otpSub').textContent='OTP sent to your mobile. Enter the 6-digit code below.';
    $('o_code').focus();
  }

  async function sendBackendEmail(){
    const body={name:$('o_name').value.trim(),phone:'',email:$('o_email').value.trim().toLowerCase(),channel:'email'};
    const r=await fetch(`${API_BASE}/api/users/otp/request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {ok:r.ok,d:await r.json().catch(()=>({}))};
  }
  async function verifyBackendEmail(){
    const body={name:$('o_name').value.trim(),phone:'',email:$('o_email').value.trim().toLowerCase(),channel:'email',code:$('o_code').value.trim()};
    const r=await fetch(`${API_BASE}/api/users/otp/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {ok:r.ok,d:await r.json().catch(()=>({}))};
  }

  $('otpStep1').onsubmit=async e=>{
    e.preventDefault();$('otpErr').textContent='';$('o_send').disabled=true;
    const oldText=$('o_send').textContent;$('o_send').textContent='Sending OTP…';
    try{
      if($('o_channel').value==='sms'){
        await sendFirebaseSms();
      }else{
        const r=await sendBackendEmail();
        if(!r.ok) throw new Error(r.d.error||'Could not send email OTP.');
        $('otpStep1').classList.add('hidden');$('otpStep2').classList.remove('hidden');$('otpSub').textContent='OTP sent to your email. Enter the 6-digit code below.';$('o_code').focus();
      }
    }catch(err){
      console.error(err);$('otpErr').textContent=$('o_channel').value==='sms'?firebaseErrorMessage(err):(err.message||'Could not send OTP. Please try again.');
      if($('o_channel').value==='sms') clearRecaptcha();
    }finally{$('o_send').disabled=false;$('o_send').textContent=oldText;}
  };

  async function finishLogin(user){
    await saveFirebaseUser(user,$('o_name').value.trim(),'sms',$('o_phone').value.trim());
    close();const action=pendingAction;pendingAction=null;if(typeof action==='function')action();else window.goTo('account');
  }

  $('otpStep2').onsubmit=async e=>{
    e.preventDefault();$('otpErr').textContent='';$('o_verify').disabled=true;
    const oldText=$('o_verify').textContent;$('o_verify').textContent='Verifying…';
    try{
      const code=$('o_code').value.trim();
      if(code.length!==6) throw new Error('Enter the 6-digit OTP.');
      if($('o_channel').value==='sms'){
        if(!confirmationResult) throw new Error('OTP session expired. Please request a new OTP.');
        const result=await confirmationResult.confirm(code);
        await finishLogin(result.user);
      }else{
        const r=await verifyBackendEmail();
        if(!r.ok) throw new Error(r.d.error||'Wrong OTP.');
        localStorage.setItem(TOKEN,r.d.token);localStorage.setItem(PROFILE,JSON.stringify(r.d.user));refreshUI();close();const action=pendingAction;pendingAction=null;if(typeof action==='function')action();else window.goTo('account');
      }
    }catch(err){console.error(err);$('otpErr').textContent=$('o_channel').value==='sms'?firebaseErrorMessage(err):(err.message||'Could not verify OTP.');}
    finally{$('o_verify').disabled=false;$('o_verify').textContent=oldText;}
  };
  $('o_code').addEventListener('input',()=>{
    $('o_code').value=$('o_code').value.replace(/\D/g,'').slice(0,6);
    if($('o_code').value.length===6 && !$('o_verify').disabled) $('otpStep2').requestSubmit();
  });

  $('userLogoutBtn').addEventListener('click',async()=>{try{if(firebaseReady())await firebase.auth().signOut();}catch(e){}localStorage.removeItem(TOKEN);localStorage.removeItem(PROFILE);refreshUI();baseGoTo('home');});
  const be=window.openEnquiry;window.openEnquiry=id=>{be(id);const u=cur();if(u){$('e_name').value=u.name;$('e_mobile').value=u.phone||'';$('e_email').value=u.email||''}};
  const mq=window.matchMedia('(max-width:900px)'),uBtn=$('userBtn'),dBtn=$('dashboardBtn'),navEl=$('mainNav'),hdrEl=document.querySelector('.main-header');
  function placeHeaderButtons(){if(mq.matches){const tr=document.querySelector('.header-top-row');tr.insertBefore(uBtn,$('navToggleBtn'));navEl.appendChild(dBtn)}else{hdrEl.appendChild(uBtn);hdrEl.appendChild(dBtn)}syncDashboardVisibility()};
  function syncDashboardVisibility(){dBtn.style.display=(mq.matches&&!cur())?'none':''};window.syncDashboardVisibility=syncDashboardVisibility;
  [uBtn,dBtn].forEach(b=>b.addEventListener('click',()=>{if(typeof closeMobileNav==='function')closeMobileNav()}));(mq.addEventListener?mq.addEventListener('change',placeHeaderButtons):mq.addListener(placeHeaderButtons));placeHeaderButtons();refreshUI();
})();
