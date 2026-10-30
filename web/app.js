/* A small, buildless interface. Python owns validation, persistence and matching. */
'use strict';

const main = document.getElementById('main');
const header = document.getElementById('header');
let config, session, profile, results;
let view = 'welcome', questionIndex = 0, demo = false, editReturn = null;
let savedProfiles = [], installPrompt = null, busy = false, justCompleted = false;
let detailId = null, toastTimer, quizJustFinished = false;
// Landing intro: the logo animation plays alone, full screen, then the page arrives on top of it.
// Once per visit, never for reduced motion, and any tap, key or scroll skips it.
const INTRO_REVEAL_MS = 8200; // The wordmark completes at ~7.5s of the 9.1s animation.
const prefersLessMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
function introDue() {
  if (!window.requestAnimationFrame || prefersLessMotion()) return false;
  try { return sessionStorage.getItem('hardlaunch-intro') !== 'seen'; } catch { return false; }
}
let conversations = [], conversation = null;
let pendingDelete = null, deleteReturn = 'profiles';
let pendingUnmatch = null, unmatchReturn = 'matches', matchStatus = null;
let pendingBlock = null, blockReturn = 'matches';
let pendingTypeChange = null, typeChangeConfirmed = false;
const stages = ['about', 'preferences', 'personality', 'quiz', 'review'];
const stageLabels = ['About you', 'Preferences', 'Personality', 'Your wavelength', 'Review'];

const wantsQuiz = () => profile?.intention === config?.quiz_intention;
const activeStages = () => stages.filter(stage => stage !== 'quiz' || wantsQuiz());
const needsQuiz = () => wantsQuiz() && config.questions.some(q => ![1, 2, 3, 4].includes(profile.answers[q.id]));

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}
const e = escapeHTML;
// An example answer for each "Finish a thought" prompt, shown as the placeholder.
const promptHints = {
  building: 'A home full of plants, a career I am proud of, and someone to build it with…',
  sunday: 'Sunday markets, a very ambitious pasta recipe, and someone to share it with…',
};
const promptHint = prompt => promptHints[prompt] || promptHints.building;
const selected = (a, b) => a === b ? ' selected' : '';
const checked = value => value ? ' checked' : '';
const avatar = (name, extra = '') => `<img src="/assets/avatars/${config?.avatars.includes(name) ? name : 'sun'}.svg" alt="" ${extra}>`;
const portrait = person => /^data:image\/(jpeg|png|webp);base64,/.test(person.photo || '') ? `<img class="profile-photo" src="${e(person.photo)}" alt="">` : avatar(person.avatar);
const workLine = person => [person.role, person.company].filter(Boolean).join(' · ');
const button = (text, action, primary = false, extra = '') => `<button type="button" class="btn ${primary ? 'btn-primary' : ''}" data-action="${action}" ${extra}>${text}</button>`;

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  } catch {
    throw new Error('The local server is unavailable. Keep this page open, start Python again, then retry your action.');
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.fields = data.fields;
    error.status = response.status;
    error.unmatch_policy = data.unmatch_policy || data.quota;
    throw error;
  }
  return data;
}

function toast(message) {
  const node = document.getElementById('toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 4500);
}

function showError(error) {
  let box = document.getElementById('form-error');
  if (!box) {
    box = document.createElement('div');
    box.id = 'form-error';
    box.className = 'error alert alert-danger';
    box.setAttribute('role', 'alert');
    main.prepend(box);
  }
  box.hidden = false;
  box.textContent = error.message;
  document.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
  if (error.fields) {
    const invalid = [...document.querySelectorAll('[name]')].filter(node => error.fields[node.name]);
    invalid.forEach(node => node.setAttribute('aria-invalid', 'true'));
    invalid[0]?.focus();
  }
  box.scrollIntoView({block:'nearest'});
}

// Small line icons; on phones and tablets the navigation becomes a bottom tab bar within thumb reach.
const navIcon = path => `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const navIcons = {
  matches: 'M12 20.5C7.6 17.4 3 13.9 3 9.3 3 6.6 5.1 4.5 7.6 4.5c1.8 0 3.4 1 4.4 2.6 1-1.6 2.6-2.6 4.4-2.6 2.5 0 4.6 2.1 4.6 4.8 0 4.6-4.6 8.1-9 11.2Z',
  messages: 'M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
  'my-profile': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8.5c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6',
  'edit-preferences': 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5',
};
// The active profile's menu. A proof of concept: one-click log in, no passwords.
function profileMenu() {
  const name = e(profile.name || 'Your profile');
  return `<div class="profile-menu dropdown" id="profile-menu">
    <button type="button" class="menu-trigger dropdown-toggle" id="profile-menu-button" data-action="profile-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-menu-list"><span class="menu-avatar">${portrait(profile)}</span><span class="menu-name">${name}</span><span class="visually-hidden">, profile menu</span></button>
    <div class="menu-list dropdown-menu dropdown-menu-end" id="profile-menu-list" role="menu" aria-labelledby="profile-menu-button" hidden>
      <div class="menu-heading dropdown-header"><span class="menu-avatar">${portrait(profile)}</span><span><strong>${name}</strong><small>Logged in · local demo, no password</small></span></div><hr class="dropdown-divider" role="separator">
      <button type="button" role="menuitem" class="menu-item dropdown-item" data-action="profiles" tabindex="-1"><span aria-hidden="true">⇄</span>Switch profile</button>
      <button type="button" role="menuitem" class="menu-item dropdown-item" data-action="logout" tabindex="-1"><span aria-hidden="true">↪</span>Log out</button>
    </div></div>`;
}
function setProfileMenu(open, focusItem = false) {
  const trigger = document.getElementById('profile-menu-button'), list = document.getElementById('profile-menu-list');
  if (!trigger || !list) return;
  trigger.setAttribute('aria-expanded', String(open));
  list.hidden = !open;
  list.classList.toggle('show', open); // Bootstrap's dropdown-menu shows with .show
  if (open && focusItem) list.querySelector('[role=menuitem]').focus();
}
function renderHeader() {
  const completed = profile?.status === 'complete' && !stages.includes(view) && view !== 'welcome';
  // Brand on the left, sections in the middle, then quiet secondary actions and the account chip.
  header.innerHTML = `<button class="brand" data-action="home" aria-label="HardLaunch home"><img src="/assets/logo.svg" alt="" width="34" height="34"><span class="wordmark">Hard<span>Launch</span></span></button>
    ${completed ? `<nav class="nav-links" aria-label="Main navigation">
    ${[['matches','Matches'],...(!demo ? [['messages','Messages']] : []),['my-profile','My profile'],['edit-preferences','Preferences']].map(([action,label]) => `<button class="nav-button ${(action === view || (view === 'detail' && action === 'matches')) ? 'active' : ''}" data-action="${action}" ${action === view ? 'aria-current="page"' : ''}>${navIcon(navIcons[action])}<span>${label}</span></button>`).join('')}</nav>` : ''}
    <div class="header-actions">${view === 'welcome' ? '<a class="header-link" href="/showcase">Our story <span aria-hidden="true">↗</span></a>' : ''}
    ${installPrompt ? `<button type="button" class="icon-button" data-action="install" aria-label="Install app" title="Install app">${navIcon('M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14')}</button>` : ''}
    ${!demo && profile ? profileMenu() : `<button class="btn btn-small ${demo ? '' : 'btn-primary'}" data-action="profiles">${demo ? 'Profiles' : 'Log in'}</button>`}</div>`;
}

function go(next, focus = true) {
  view = next === 'quiz' && !wantsQuiz() ? 'review' : next;
  renderHeader();
  if (view === 'welcome') main.innerHTML = welcome();
  else if (stages.includes(view)) main.innerHTML = builder();
  else if (view === 'matches') main.innerHTML = matchesPage();
  else if (view === 'detail') main.innerHTML = detailPage();
  else if (view === 'my-profile') main.innerHTML = myProfile();
  else if (view === 'profiles') main.innerHTML = profilesPage();
  else if (view === 'messages') main.innerHTML = messagesPage();
  else if (view === 'chat') main.innerHTML = chatPage();
  else if (view === 'delete-profile') main.innerHTML = deleteProfilePage();
  else if (view === 'unmatch') main.innerHTML = unmatchPage();
  else if (view === 'block') main.innerHTML = blockPage();
  else if (view === 'wavelength') main.innerHTML = wavelengthPage();
  else if (view === 'confirm-type') main.innerHTML = confirmTypePage();
  document.title = `${({welcome:'Meet someone on your wavelength', matches:'Your introductions', detail:'Why you connect', 'my-profile':'My profile', profiles:'Local profiles', messages:'Your conversations', chat:'Your conversation', 'delete-profile':'Delete profile', unmatch:'Review unmatch', block:'Block or report', wavelength:'Your wavelength', 'confirm-type':'Change relationship type'})[view] || stageLabels[stages.indexOf(view)]} — HardLaunch`;
  if (focus) {
    window.scrollTo({top:0, behavior:'instant'});
    main.focus({preventScroll:true});
  }
  if (view === 'chat') {
    const history = document.getElementById('message-history');
    if (history) { history.tabIndex = 0; history.scrollTop = history.scrollHeight; }
  }
  if (window.requestAnimationFrame) {
    if (view === 'welcome' && introDue()) playIntro();
    else if (view !== 'welcome') removeIntro();
  }
  // Music belongs to the quiz: it rests when you leave and picks up when you return.
  if (view === 'quiz') {
    moveHeart();
    if (music.resume) music.play().then(() => refreshSoundtrack()).catch(() => {});
    if (window.requestAnimationFrame && document.getElementById('coach')) pinCoach();
    else if (!hasSeenCoach(profile.id)) showCoach();
  } else {
    if (window.requestAnimationFrame) removeCoach();
    heartShown = 0;
    if (music.playing) music.pause(true);
  }
  showSpotifyDock();
}

function playIntro() {
  if (!window.requestAnimationFrame || document.getElementById('intro-screen')) return;
  try { sessionStorage.setItem('hardlaunch-intro', 'seen'); } catch { /* It may play again next visit. */ }
  const screen = document.createElement('div');
  screen.id = 'intro-screen';
  screen.className = 'intro-screen';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', 'HardLaunch intro');
  screen.style.setProperty('--intro-ms', `${INTRO_REVEAL_MS}ms`);
  // A fresh URL restarts the GIF from its first frame.
  screen.innerHTML = `<img class="intro-gif" src="/assets/intro.gif?play=${Date.now()}" width="540" height="540" alt="A hand lets go of a heart. It rises, and becomes the HardLaunch logo: a rocket launching from a heart.">
    <div class="intro-progress" aria-hidden="true"><span></span></div>
    <p class="intro-hint" aria-hidden="true">Tap anywhere to skip</p>
    <button type="button" class="intro-skip">Skip intro <span aria-hidden="true">→</span></button>`;
  document.getElementById('landing')?.classList.remove('revealed');
  document.body.append(screen);
  document.documentElement.classList.add('intro-open');
  const skip = event => {
    if (event.type === 'keydown' && ['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    event.preventDefault();
    revealLanding();
  };
  const start = () => { screen.classList.add('playing'); screen.timer = setTimeout(revealLanding, INTRO_REVEAL_MS); };
  const gif = screen.querySelector('.intro-gif');
  if (gif.complete) start(); else { gif.onload = start; gif.onerror = revealLanding; }
  screen.addEventListener('click', skip);
  screen.addEventListener('wheel', skip, {passive:false});
  screen.addEventListener('touchmove', skip, {passive:false});
  window.addEventListener('keydown', skip, true);
  screen.cleanup = () => {
    clearTimeout(screen.timer);
    window.removeEventListener('keydown', skip, true);
  };
  screen.querySelector('.intro-skip').focus();
}
// The intro fades away and the landing content rises on top of the logo it ended on.
function revealLanding() {
  const screen = document.getElementById('intro-screen');
  if (screen && !screen.classList.contains('leaving')) {
    screen.cleanup();
    screen.classList.add('leaving');
    setTimeout(() => screen.remove(), 700);
  }
  document.documentElement.classList.remove('intro-open');
  document.getElementById('landing')?.classList.add('revealed');
  main.focus({preventScroll:true});
}
function removeIntro() {
  const screen = document.getElementById('intro-screen');
  if (screen) { screen.cleanup(); screen.remove(); }
  document.documentElement.classList.remove('intro-open');
}

function welcome() {
  return `<div class="welcome">
    <section class="hero landing ${introDue() ? '' : 'revealed'}" id="landing" aria-labelledby="welcome-title">
      <div class="landing-backdrop" aria-hidden="true"><img src="/assets/intro-still.png" alt="" width="540" height="540"></div>
      <div class="landing-content"><div class="eyebrow">Dating with intent</div>
        <h1 id="welcome-title">Meet someone<br>on your <em>wavelength.</em></h1>
        <p>A little about you. A few things that matter. Someone worth meeting.</p>
        <div class="hero-actions">${button('Find my people <span class="arrow" aria-hidden="true">↗</span>', 'new', true)}${button('Take a little peek <span aria-hidden="true">→</span>', 'demo')}</div>
        <div class="hero-footnote"><div class="tiny-avatars">${avatar('flower')}${avatar('sun')}${avatar('peach')}</div><span>Your intention. Your city. Your kind of connection.</span></div>
      </div>
      <div class="floating-card float-one" aria-hidden="true">${avatar('flower')}<div class="mini-name">A little curious.</div><div class="mini-caption">Big bookshop energy.</div></div>
      <div class="floating-card float-two" aria-hidden="true">${avatar('sun')}<div class="mini-name">A little sunny.</div><div class="mini-caption">Up for an adventure.</div></div>
      <div class="hero-sticker" aria-hidden="true">good things<br>start here</div>
      <button type="button" class="intro-replay" data-action="replay-intro"><span aria-hidden="true">↺</span><span class="replay-label"> Replay intro</span></button>
      <a class="scroll-cue" href="#how-it-works">Scroll to explore <span aria-hidden="true">↓</span></a>
    </section>
    <section class="intro-strip" id="how-it-works" aria-label="How HardLaunch works"><div class="row row-cols-1 row-cols-md-3 g-4">
      ${[['01','Make it you.','An avatar or photo, your preferences, and the things you love.'],['02','Choose your intention.','Seeking a long-term relationship? Take our 15-question compatibility quiz.'],['03','Say your first hello.','Meet people in your city. Try a conversation between two local profiles.']].map(([n,title,text]) => `<div class="col"><div class="intro-item"><span class="step-number">${n}</span><div><h3>${title}</h3><p>${text}</p></div></div></div>`).join('')}
    </div></section>
    <div class="welcome-bottom"><p>A local course-project demo. The sample people are fictional.</p>${session ? button(`${session.profile.status === 'complete' ? 'Return to' : 'Continue'} ${e(session.profile.name || 'your profile')} <span aria-hidden="true">→</span>`, 'resume') : '<span class="small-label">Less scrolling. More possibility.</span>'}</div>
    <div class="local-demo-callout"><div><h3>Two people. One first hello.</h3><p>For your presentation: create Avery and Jordan locally, send a message, then switch profiles to reply.</p></div>${button('Try the two-person demo','demo-pair')}</div>
    ${savedProfiles.length ? `<div class="saved-profiles"><label for="saved-profile">Open a saved profile</label><select id="saved-profile" class="form-select"><option value="">Choose a profile</option>${savedProfiles.map(p => `<option value="${e(p.id)}">${e(p.name || 'Unfinished profile')}${p.status === 'draft' ? ' · unfinished' : ''}</option>`).join('')}</select>${button('Open', 'open-saved', false)}</div>` : ''}
  </div>`;
}

function stepper() {
  const visible = activeStages();
  const current = visible.indexOf(view);
  return `<ol id="onboarding-progress" class="stepper" aria-label="Profile progress">${visible.map((stage,i) => `<li class="${i === current ? 'current' : i < current ? 'done' : ''}" ${i === current ? 'aria-current="step"' : ''}><span class="step-count">${i < current ? '✓' : i + 1}</span><span>${stageLabels[stages.indexOf(stage)]}</span></li>`).join('')}</ol>`;
}

function field(name, label, html, note = '') {
  return `<div class="field"><label for="${name}">${label}</label>${html}${note ? `<p class="field-note" id="${name}-help">${note}</p>` : ''}</div>`;
}
function textInput(name, placeholder, max = 40, required = false) {
  return `<input class="form-control" id="${name}" name="${name}" value="${e(profile[name])}" placeholder="${e(placeholder)}" maxlength="${max}" ${required ? 'required' : ''} autocomplete="${name === 'name' ? 'given-name' : 'off'}">`;
}
function selectInput(name, choices, placeholder = '', required = true) {
  const entries = Array.isArray(choices) ? choices.map(v => [v,v]) : Object.entries(choices);
  return `<select class="form-select" id="${name}" name="${name}" ${required ? 'required' : ''}>${placeholder ? `<option value="">${placeholder}</option>` : ''}${entries.map(([value,label]) => `<option value="${e(value)}"${selected(profile[name],value)}>${e(label)}</option>`).join('')}</select>`;
}

function profileCard(person = profile) {
  const gender = person.gender === 'another' && person.identity_text ? person.identity_text : config.genders[person.gender];
  return `<article class="profile-card"><div class="profile-art tone-${e(person.avatar || 'sun')}">${portrait(person)}<span class="pill light">${person.status === 'draft' ? 'A meet-cute in the making' : 'A little about me'}</span></div>
    <div class="profile-card-body"><h2>${e(person.name || 'Your name')}${person.age ? `, ${person.age}` : ''}</h2>
    <p class="profile-meta">${e([person.city || 'Your little corner of the world', person.pronouns].filter(Boolean).join(' · '))}</p>
    ${gender ? `<p class="profile-meta">${e(gender)}</p>` : ''}
    ${workLine(person) ? `<p class="profile-work">${e(workLine(person))}</p>` : ''}
    <div class="chip-list">${(person.interests || []).length ? person.interests.map(i => `<span class="pill">${e(i)}</span>`).join('') : '<span class="pill">A few favourite things go here</span>'}</div>
    ${person.intention ? `<p class="profile-meta">${e(person.intention)}</p>` : ''}
    <div class="profile-prompt"><p class="small-label">${e(config.prompts[person.prompt] || config.prompts.building)}</p><p>${e(person.building_toward || 'Your story is still unfolding. Add a little something that feels like you.')}</p></div></div></article>`;
}

function preview() {
  return `<aside class="preview-column" aria-label="Live profile preview"><div class="preview-label"><span class="small-label">Your profile, coming to life</span><span aria-hidden="true">✳</span></div><div id="live-profile">${profileCard()}</div><div class="preview-dots" aria-hidden="true"><i></i><i></i><i></i></div><p class="preview-caption">A little more you with every step.<br>Your preferences and quiz answers stay off this card.</p></aside>`;
}

function pictureFields() {
  return `<fieldset><legend>Choose an avatar or a photo</legend><div class="avatar-picker">${config.avatars.map(a => `<label class="avatar-choice"><input type="radio" name="avatar" value="${a}"${checked(!profile.photo && profile.avatar === a)} aria-label="${a[0].toUpperCase()+a.slice(1)} avatar">${avatar(a)}<span class="avatar-tick" aria-hidden="true">✓</span></label>`).join('')}</div><div class="photo-control">${field('photo','Upload your photo <span class="optional">optional</span>','<input type="file" id="photo" class="form-control" name="photo" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help">','JPEG, PNG or WebP, up to 2 MB. Stored only on this laptop.')}<p id="photo-status" role="status">${profile.photo ? 'Your photo is selected. Pick an avatar to replace it.' : 'Your avatar is selected.'}</p></div></fieldset>`;
}

function aboutForm() {
  return `<div class="eyebrow">01 / Hello, you</div><h1>Let's start with you.</h1><p class="subtext">The basics, with a little personality. You can change these later.</p>
    <div class="form-fields">
      ${pictureFields()}
      <div class="field-row">${field('name','First name',textInput('name','What should we call you?',40,true))}${field('age','Age',`<input class="form-control" id="age" name="age" type="number" min="18" max="99" step="1" value="${profile.age || ''}" placeholder="18 or over" required>`)}</div>
      ${field('city','Your city',selectInput('city',config.cities,'Choose your city'),'We introduce people in the same city. No GPS or exact address.')}
      <div class="field-row">${field('gender','Your gender',selectInput('gender',config.genders,'Choose your gender'))}${field('pronouns','Pronouns <span class="optional">optional</span>',textInput('pronouns','e.g. they / them'))}</div>
      <div id="identity-field" ${profile.gender !== 'another' ? 'hidden' : ''}>${field('identity_text','In your own words <span class="optional">optional</span>',textInput('identity_text','How you describe your gender',60),'Matching uses the “Another identity” group you selected.')}</div>
    </div>`;
}

function preferencesForm() {
  return `<div class="eyebrow">02 / Your kind of connection</div><h1>Who feels like your people?</h1><p class="subtext">Your identity is yours. These preferences tell us who you'd like to meet.</p>
    <div class="form-fields"><fieldset><legend>I'm interested in meeting</legend>
    <label class="choice everyone"><input type="checkbox" class="form-check-input" id="everyone"${checked(profile.preferred_genders.length === 4)}>Everyone</label>
    <div class="choice-grid">${Object.entries(config.preferences).map(([value,label]) => `<label class="choice"><input type="checkbox" class="form-check-input" name="preferred_genders" value="${value}"${checked(profile.preferred_genders.includes(value))}>${e(label)}</label>`).join('')}</div><p class="field-note">Choose one or more. Both people's preferences need to match.</p></fieldset>
    <fieldset><legend>Preferred age range</legend><div class="field-row">${field('age_min','From',`<input class="form-control" id="age_min" name="age_min" type="number" min="18" max="99" step="1" required value="${profile.age_min}">`)}${field('age_max','To',`<input class="form-control" id="age_max" name="age_max" type="number" min="18" max="99" step="1" required value="${profile.age_max}">`)}</div></fieldset>
    <fieldset><legend>Right now, I'm looking for</legend><div class="intention-list">${config.intentions.map(intent => `<label class="choice"><input type="radio" class="form-check-input" name="intention" value="${e(intent)}" required${checked(profile.intention === intent)}>${e(intent)}</label>`).join('')}</div><p class="field-note">The 15-question compatibility quiz is only for long-term relationships. Other intentions skip the quiz.</p>${demo ? '' : profile.status === 'complete' ? '<p class="notice" id="refresh-note"><strong>Your relationship type can change only once a month.</strong> Changing it refreshes your matches automatically, without using an unmatch, and saved chats stay read-only.</p>' : '<p class="notice" id="refresh-note"><strong>Choose carefully.</strong> HardLaunch is for people looking for a genuine match. Once your profile is complete, your relationship type can change only once a month.</p>'}</fieldset></div>`;
}

function personalityForm() {
  return `<div class="eyebrow">03 / The good little details</div><h1>Make it a little more you.</h1><p class="subtext">The things you love make the best conversation starters.</p>
    <div class="form-fields"><fieldset><legend>A few favourite things <span class="optional">choose up to 3</span></legend><div class="chip-list">${config.interests.map(interest => `<label class="interest-choice"><input type="checkbox" class="form-check-input" name="interests" value="${e(interest)}"${checked(profile.interests.includes(interest))}>${e(interest)}</label>`).join('')}</div><p class="field-note" id="interest-count">${profile.interests.length} of 3 selected · optional</p></fieldset>
    <div class="field-row">${field('role','Job title or occupation <span class="optional">optional</span>',textInput('role','e.g. Student or designer',80))}${field('company','Workplace or university <span class="optional">optional</span>',textInput('company','Where you work or study',80))}</div><p class="field-note">These details will be visible on your profile.</p>
    ${field('prompt','Finish a thought <span class="optional">optional</span>',selectInput('prompt',config.prompts))}
    ${field('building_toward','In your own words',`<textarea class="form-control" id="building_toward" name="building_toward" maxlength="240" placeholder="${e(promptHint(profile.prompt))}">${e(profile.building_toward)}</textarea>`)}<p class="counter" id="prompt-count">${profile.building_toward.length} / 240</p></div>`;
}

// Quiz music: gentle loops played live with Web Audio (no files, works offline),
// or a song chosen from this device. Silent until the person presses play.
const soundtracks = {
  lofi: {name:'Lo-fi crush', bpm:74, swing:.18, cutoff:1900, chords:[[53,57,60,64],[52,55,59,62],[50,53,57,60],[48,52,55,59]]},
  sunset: {name:'Sunset synth', bpm:104, swing:0, cutoff:4200, chords:[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]},
  musicbox: {name:'Music box', bpm:88, swing:0, cutoff:7000, chords:[[60,64,67],[57,60,64],[53,57,60],[55,59,62]]},
};
const midi = note => 440 * 2 ** ((note - 69) / 12);
// Accepts Spotify share links (open.spotify.com/…) and spotify: URIs; returns a spotify: URI or ''.
const spotifyPattern = /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(track|album|playlist|episode|show|artist)[/:]([A-Za-z0-9]{22})(?:[/?#]|$)/;
function spotifyUri(link) {
  const match = String(link).trim().match(spotifyPattern);
  return match ? `spotify:${match[1]}:${match[2]}` : '';
}
const spotifyLink = uri => uri ? `https://open.spotify.com/${uri.split(':')[1]}/${uri.split(':')[2]}` : '';
// Spotify's own embed player, docked outside the quiz content (which is redrawn for every
// question). It is a plain iframe, so no Spotify script runs on this page; people press ▶ in it.
// Signed in to Spotify in this browser plays whole songs; otherwise Spotify plays 30-second previews.
function mountSpotify(uri) {
  let dock = document.getElementById('spotify-dock');
  if (!dock) {
    dock = document.createElement('aside');
    dock.id = 'spotify-dock';
    dock.className = 'spotify-dock';
    dock.setAttribute('aria-label', 'Spotify player for your quiz music');
    document.body.append(dock);
  }
  const [, type, id] = uri.split(':');
  dock.innerHTML = `<iframe title="Spotify player" src="https://open.spotify.com/embed/${type}/${id}" width="100%" height="80" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
  showSpotifyDock();
}
function unmountSpotify() {
  const dock = document.getElementById('spotify-dock');
  if (!dock || !dock.firstElementChild) return;
  dock.innerHTML = ''; // Removing the player is what stops its music.
  showSpotifyDock();
}
function showSpotifyDock() {
  const dock = document.getElementById('spotify-dock');
  if (!dock || !document.documentElement) return;
  dock.hidden = !(view === 'quiz' && dock.firstElementChild);
  document.documentElement.classList.toggle('spotify-docked', !dock.hidden);
}
const music = {
  track:'lofi', volume:.6, playing:false, resume:false, ctx:null, timer:null, step:0, next:0, audio:null, fileName:'',
  spotifyUri:'', spotifyEditing:false,
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('hardlaunch-music')) || {};
      if (soundtracks[saved.track] || ['own', 'spotify'].includes(saved.track)) this.track = saved.track;
      if (saved.volume >= 0 && saved.volume <= 1) this.volume = saved.volume;
      this.spotifyUri = spotifyUri(saved.spotifyUri || '');
    } catch { /* Private windows can block storage; the defaults are fine. */ }
  },
  save() { try { localStorage.setItem('hardlaunch-music', JSON.stringify({track:this.track, volume:this.volume, spotifyUri:this.spotifyUri})); } catch { /* Not essential. */ } },
  setup() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = ctx.createDynamicsCompressor();
    out.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.connect(out);
    this.bus = ctx.createGain();
    this.bus.gain.value = .0001;
    this.bus.connect(this.filter);
    this.sfx = ctx.createGain(); // Chimes stay audible while the loop fades out.
    this.sfx.connect(out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  },
  tone(note, at, length, {type = 'sine', gain = .15, attack = .01, detune = 0, bus = this.bus} = {}) {
    const osc = this.ctx.createOscillator(), amp = this.ctx.createGain();
    osc.type = type; osc.frequency.value = midi(note); osc.detune.value = detune;
    amp.gain.setValueAtTime(.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + attack);
    amp.gain.exponentialRampToValueAtTime(.0001, at + attack + length);
    osc.connect(amp).connect(bus);
    osc.start(at); osc.stop(at + attack + length + .05);
  },
  hit(at, {freq = 7000, type = 'highpass', gain = .05, length = .05} = {}) {
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), amp = this.ctx.createGain();
    source.buffer = this.noise; filter.type = type; filter.frequency.value = freq;
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(filter).connect(amp).connect(this.bus);
    source.start(at); source.stop(at + length + .02);
  },
  kick(at, gain) {
    const osc = this.ctx.createOscillator(), amp = this.ctx.createGain();
    osc.frequency.setValueAtTime(130, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + .14);
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(.0001, at + .32);
    osc.connect(amp).connect(this.bus);
    osc.start(at); osc.stop(at + .35);
  },
  // One sixteenth note of the loop. Each chord lasts a bar.
  sixteenth(step, at, beat) {
    const s = step % 16, bar = Math.floor(step / 16), chords = soundtracks[this.track].chords;
    const chord = chords[bar % chords.length];
    if (this.track === 'lofi') {
      if (s === 0) chord.forEach((n, i) => this.tone(n, at, beat * 15, {type:'triangle', gain:.045, attack:.25, detune:i % 2 ? 6 : -6}));
      if (s === 0 || s === 10) this.tone(chord[0] - 12, at, beat * 5, {gain:.2, attack:.02});
      if ([0, 7, 10].includes(s)) this.kick(at, .45);
      if (s === 4 || s === 12) this.hit(at, {freq:1800, type:'bandpass', gain:.12, length:.16});
      if (s % 2 === 0) this.hit(at, {gain:.025});
      if ([2, 6, 9, 14].includes(s) && (bar + s) % 3) this.tone(chord[(s + bar) % chord.length] + 12, at, beat * 3, {gain:.06});
    } else if (this.track === 'sunset') {
      if (s === 0) chord.forEach(n => [-7, 7].forEach(detune => this.tone(n, at, beat * 15, {type:'sawtooth', gain:.018, attack:.3, detune})));
      if (s % 4 === 0) this.kick(at, .4);
      if (s % 4 === 2) { this.tone(chord[0] - 12, at, beat * 1.5, {type:'square', gain:.05}); this.hit(at, {gain:.035}); }
      if (s % 2 === 0) this.tone(chord[[0, 1, 2, 1, 0, 2, 1, 2][s / 2] % chord.length] + 12, at, beat * 1.8, {type:'triangle', gain:.05});
    } else {
      if (s === 0) this.tone(chord[0] - 12, at, beat * 14, {gain:.08, attack:.05});
      if (s % 2 === 0) {
        const n = chord[[2, 1, 0, 1, 2, 2, 1, 0][(s / 2 + bar) % 8] % chord.length] + 24;
        this.tone(n, at, beat * 5, {gain:.07, attack:.004});
        this.tone(n + 19, at, beat * 2, {gain:.012, attack:.004});
      }
    }
  },
  tick() {
    const song = soundtracks[this.track], beat = 60 / song.bpm / 4;
    while (this.next < this.ctx.currentTime + .15) {
      this.sixteenth(this.step, this.next + (this.step % 2 ? song.swing * beat : 0), beat);
      this.step++; this.next += beat;
    }
  },
  async play() {
    if (this.track === 'own' && !this.audio) { document.getElementById('music-file')?.click(); return; }
    if (this.track === 'spotify' && !this.spotifyUri) { this.spotifyEditing = true; return; } // Ask for a link first.
    this.setup(); // Web Audio is still needed for the answer chimes.
    await this.ctx.resume();
    this.stop();
    const now = this.ctx.currentTime;
    this.sfx.gain.value = this.volume * .6;
    if (this.track === 'own') {
      this.audio.volume = this.volume;
      try { await this.audio.play(); } catch { throw new Error('That song can’t be played here. Try an MP3, M4A, WAV or OGG file.'); }
    } else if (this.track === 'spotify') {
      mountSpotify(this.spotifyUri);
    } else {
      this.filter.frequency.value = soundtracks[this.track].cutoff;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(this.volume * .55, now, .08);
      this.step = 0; this.next = now + .06;
      this.timer = setInterval(() => this.tick(), 25);
    }
    this.playing = true; this.resume = false;
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.audio?.pause();
    unmountSpotify();
    if (this.ctx) this.bus.gain.setTargetAtTime(.0001, this.ctx.currentTime, .06);
  },
  // resumeLater: paused because the person left the quiz, so play again when they return.
  pause(resumeLater = false) { this.stop(); this.playing = false; this.resume = resumeLater; },
  setVolume(value) {
    this.volume = value; this.save();
    if (this.audio) this.audio.volume = value;
    if (!this.ctx) return;
    this.sfx.gain.value = value * .6;
    if (this.playing && soundtracks[this.track]) this.bus.gain.setTargetAtTime(value * .55, this.ctx.currentTime, .05);
  },
  async choose(track) {
    const wasPlaying = this.playing;
    this.pause();
    this.track = track; this.save();
    this.spotifyEditing = track === 'spotify' && !this.spotifyUri;
    if (wasPlaying || (track === 'own' && !this.audio)) await this.play();
  },
  async useSpotify(link) {
    const uri = spotifyUri(link);
    if (!uri) throw new Error('Paste a Spotify link to a song, album or playlist, such as https://open.spotify.com/track/…');
    this.pause();
    this.track = 'spotify'; this.spotifyUri = uri; this.spotifyEditing = false; this.save();
    await this.play();
  },
  async useFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('audio/')) throw new Error('Choose an audio file, such as an MP3.');
    this.pause();
    if (this.audio) URL.revokeObjectURL(this.audio.src);
    this.audio = new Audio(URL.createObjectURL(file)); // Played from memory; never uploaded.
    this.audio.loop = true;
    this.fileName = file.name; this.track = 'own'; this.save();
    await this.play();
  },
  chime(kind) {
    if (!this.playing || !this.ctx) return;
    const at = this.ctx.currentTime + .02;
    ({pick:[76, 83], chapter:[72, 76, 79, 84], finish:[72, 76, 79, 84, 88, 91]})[kind]
      .forEach((n, i) => this.tone(n, at + i * .085, .5, {gain:.08, attack:.005, bus:this.sfx}));
  },
};
music.load();

function spotifyForm() {
  return `<form id="spotify-form" class="spotify-form"><label for="spotify-link">Spotify song, album or playlist link</label>
    <div class="spotify-row"><input class="form-control" id="spotify-link" name="spotify" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://open.spotify.com/track/…" value="${e(spotifyLink(music.spotifyUri))}"><button class="btn btn-small btn-primary" type="submit">Open in Spotify player</button></div>
    <p class="field-note">In Spotify, choose Share → Copy link, then paste it here. <a href="https://open.spotify.com/search" target="_blank" rel="noopener noreferrer">Find a song on Spotify <span aria-hidden="true">↗</span></a><br>The player opens at the bottom of the screen; press ▶ in it. Signed in to Spotify in this browser? Whole songs play. Otherwise, 30-second previews. Needs the internet.</p></form>`;
}
const musicFocus = () => music.track === 'spotify' && music.spotifyEditing ? 'spotify-link' : 'music-track';
function soundtrackBar() {
  const name = music.track === 'own' ? music.fileName || 'Your own song' : music.track === 'spotify' ? 'Spotify' : soundtracks[music.track].name;
  const status = music.playing && music.track === 'spotify' ? 'Spotify player is open · press ▶ in it to start your song.' : music.playing ? `Now playing · ${e(name)}` : music.track === 'own' && !music.audio ? 'Pick a song from this device. It stays on this laptop.' : music.track === 'spotify' && !music.spotifyUri ? 'Paste a Spotify link to choose your song.' : 'Music is off until you press play.';
  const spotifyReady = music.track === 'spotify' && music.spotifyUri && !music.spotifyEditing;
  return `<section id="soundtrack" class="soundtrack ${music.playing ? 'playing' : ''}" aria-label="Quiz music">
    <button type="button" class="music-toggle" data-action="music-toggle" aria-pressed="${music.playing}"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${music.track === 'spotify' ? (music.playing ? 'Close player' : 'Open player') : music.playing ? 'Pause' : 'Play'}<span class="visually-hidden"> ${music.track === 'spotify' ? 'for Spotify' : 'quiz music'}</span></button>
    <label class="music-pick"><span class="visually-hidden">Choose your quiz music</span><select class="form-select" id="music-track">${Object.entries(soundtracks).map(([key, song]) => `<option value="${key}"${selected(music.track, key)}>${song.name}</option>`).join('')}<option value="own"${selected(music.track, 'own')}>Your own song…</option><option value="spotify"${selected(music.track, 'spotify')}>Spotify…</option></select></label>
    ${music.track === 'own' ? `<button type="button" class="text-link" data-action="music-file">${music.audio ? 'Change song' : 'Choose a song'}</button>` : ''}
    ${spotifyReady ? '<button type="button" class="text-link" data-action="spotify-edit">Change song</button>' : ''}
    ${music.track === 'spotify' ? '' : `<label class="music-volume"><span aria-hidden="true">♪</span><span class="visually-hidden">Music volume</span><input type="range" id="music-volume" min="0" max="1" step="0.05" value="${music.volume}"></label>`}
    <input type="file" id="music-file" accept="audio/*" hidden>
    <p class="music-status" aria-live="polite">${status}</p>
    ${music.track === 'spotify' && !spotifyReady ? spotifyForm() : ''}</section>`;
}
function refreshSoundtrack(focusId) {
  const bar = document.getElementById('soundtrack');
  if (!bar) return;
  bar.outerHTML = soundtrackBar();
  if (focusId) document.getElementById(focusId)?.focus();
}

// The heart climbs as answers come in: visible progress, with a little joy at each chapter.
let heartShown = 0;
const heartSVG = '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M17 28.6C9.6 23.5 1.6 17.4 1.6 9.6 1.6 5 5.2 1.6 9.5 1.6c3.2 0 5.9 1.8 7.5 4.6 1.6-2.8 4.3-4.6 7.5-4.6 4.3 0 7.9 3.4 7.9 8 0 7.8-8 13.9-15.4 19Z"/><path class="heart-shine" d="M6.6 8.4c.5-1.7 1.8-2.8 3.6-3"/></svg>';
const heartMoods = [[1, 'On your wavelength'], [.8, 'Nearly there'], [.6, 'Heart racing'], [.4, 'Heart fluttering'], [.2, 'Getting warmer'], [0, 'Warming up']];
const heartMood = p => heartMoods.find(([at]) => p >= at - .001)[1];
const heartProgress = () => (questionIndex + (profile.answers[config.questions[questionIndex].id] ? 1 : 0)) / 15;

function heartTrack() {
  const chapters = [...new Set(config.questions.map(q => q.chapter))], p = heartShown;
  return `<aside id="heart-track" class="heart-track" style="--p:${p}" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="15" aria-valuenow="${Math.round(p * 15)}">
    <div class="track-head"><span class="track-mood" id="track-mood">${heartMood(p)}</span><span class="track-count" id="track-count">${Math.round(p * 15)} of 15</span></div>
    <div class="track-rail"><span class="track-fill"></span>
      ${chapters.map((chapter, i) => { const at = (i + 1) / chapters.length; return `<span class="track-stop ${p >= at - .001 ? 'reached' : ''}" data-at="${at}" style="--at:${at}"><span>${e(chapter)}</span></span>`; }).join('')}
      <span class="track-heart"><span class="heart-hop" id="heart-hop">${heartSVG}</span></span></div>
    <div class="track-goal" aria-hidden="true"><span>✦</span> Your introductions</div></aside>`;
}

function burstHearts(origin, count) {
  for (let i = 0; i < count; i++) {
    const heart = document.createElement('span');
    heart.className = 'float-heart';
    heart.textContent = '♥';
    heart.style.setProperty('--dx', `${Math.round((Math.random() - .5) * 80)}px`);
    heart.style.animationDelay = `${i * 60}ms`;
    origin.append(heart);
    setTimeout(() => heart.remove(), 1300 + i * 60);
  }
}

// Slide the heart from where it last sat to the current progress; celebrate when a pick moves it up.
function moveHeart(celebrate = false) {
  const track = document.getElementById('heart-track');
  if (!track || !window.requestAnimationFrame) return;
  const from = heartShown, to = heartProgress(), answered = Math.round(to * 15);
  heartShown = to;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    track.style.setProperty('--p', to);
    track.setAttribute('aria-valuenow', answered);
    track.setAttribute('aria-valuetext', `${answered} of 15 answered. ${heartMood(to)}.`);
    document.getElementById('track-mood').textContent = heartMood(to);
    document.getElementById('track-count').textContent = `${answered} of 15`;
    track.querySelectorAll('.track-stop').forEach(stop => {
      const at = Number(stop.dataset.at);
      stop.classList.toggle('reached', to >= at - .001);
      stop.classList.toggle('just', celebrate && from < at - .001 && to >= at - .001);
    });
    if (!celebrate) return;
    const hop = document.getElementById('heart-hop'), rose = to > from;
    hop.classList.remove('leap', 'beat');
    void hop.offsetWidth; // Restart the animation.
    hop.classList.add(rose ? 'leap' : 'beat');
    hop.addEventListener('animationend', () => hop.classList.remove('leap', 'beat'), {once:true});
    if (!rose) return;
    const chapterDone = Math.floor(to * 5 + .001) > Math.floor(from * 5 + .001);
    burstHearts(track.querySelector('.track-heart'), to >= 1 ? 10 : chapterDone ? 6 : 3);
    music.chime(to >= 1 ? 'finish' : chapterDone ? 'chapter' : 'pick');
  }));
}

// Quiz welcome: a heart-shaped hello, with numbered coach marks pinned to what it describes.
// Any click, tap or key closes it with a burst and lands on the first answer.
const coachShown = new Set();
function hasSeenCoach(id) {
  if (coachShown.has(id)) return true;
  try { return JSON.parse(localStorage.getItem('hardlaunch-quiz-welcome') || '[]').includes(id); } catch { return false; }
}
function rememberCoach(id) {
  coachShown.add(id);
  try {
    const seen = JSON.parse(localStorage.getItem('hardlaunch-quiz-welcome') || '[]');
    if (!seen.includes(id)) localStorage.setItem('hardlaunch-quiz-welcome', JSON.stringify([...seen, id].slice(-50)));
  } catch { /* The in-memory set still prevents repeats this visit. */ }
}
const coachTips = touch => [
  ['heart-track', 'Your heart climbs as you answer.'],
  ['soundtrack', 'Pick music: built-in, your own song or Spotify.'],
  ['answer-list', touch ? 'Tap the answer that feels like you.' : 'Press A–D to answer, Enter to continue, M for music.'],
];
// A fuller heart than the progress heart, so the welcome text fits inside its lobes.
const bubbleHeartSVG = '<svg viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true"><path d="M50 88C22 70 2 52 2 28 2 12 14 2 28 2c10 0 18 6 22 14C54 8 62 2 72 2c14 0 26 10 26 26 0 24-20 42-48 60Z"/></svg>';
// Numbered pins on the real controls. Run again if the quiz redraws while the welcome is open.
function pinCoach() {
  coachTips(false).forEach(([id], i) => {
    const target = document.getElementById(id);
    if (!target || target.querySelector('.coach-pin')) return;
    target.classList.add('coach-spot');
    target.insertAdjacentHTML('beforeend', `<span class="coach-pin" aria-hidden="true">${i + 1}</span>`);
  });
}
function showCoach() {
  if (!window.requestAnimationFrame || document.getElementById('coach')) return;
  rememberCoach(profile.id);
  const touch = window.matchMedia('(hover: none)').matches;
  const tips = coachTips(touch);
  const backdrop = document.createElement('div');
  backdrop.className = 'coach-backdrop';
  const coach = document.createElement('div');
  coach.id = 'coach';
  coach.className = 'coach';
  coach.tabIndex = -1;
  coach.setAttribute('role', 'dialog');
  coach.setAttribute('aria-modal', 'true');
  coach.setAttribute('aria-labelledby', 'coach-title');
  coach.innerHTML = `<div class="coach-bubble">${bubbleHeartSVG}<div class="coach-content"><p class="coach-eyebrow">Your wavelength · 15 questions</p><h2 id="coach-title">Welcome to the quiz</h2>
    <ol class="coach-tips">${tips.map(([, text], i) => `<li><span aria-hidden="true">${i + 1}</span>${text}</li>`).join('')}</ol>
    <p class="coach-go">${touch ? 'Tap' : 'Click'} anywhere to begin <span aria-hidden="true">✦</span></p></div></div>`;
  pinCoach();
  document.body.append(backdrop, coach);
  document.documentElement.classList.add('coach-open');
  coach.focus({preventScroll:true});
  // Capture first, so the dismissing click never also picks an answer underneath.
  const dismiss = event => { event.preventDefault(); event.stopPropagation(); closeCoach(); };
  const swallow = event => { event.preventDefault(); event.stopPropagation(); };
  window.addEventListener('pointerdown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
  window.addEventListener('click', swallow, true);
  coach.cleanup = () => {
    window.removeEventListener('pointerdown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
    // The click that follows the pointerdown still needs swallowing.
    setTimeout(() => window.removeEventListener('click', swallow, true), 400);
  };
}
function closeCoach() {
  const coach = document.getElementById('coach');
  if (!coach || coach.classList.contains('closing')) return;
  coach.cleanup();
  coach.classList.add('closing');
  document.querySelector('.coach-backdrop')?.classList.add('closing');
  const box = coach.querySelector('.coach-bubble').getBoundingClientRect();
  for (let i = 0; i < 18; i++) {
    const bit = document.createElement('span'), angle = i / 18 * Math.PI * 2, distance = 130 + Math.random() * 110;
    bit.className = 'coach-burst';
    bit.textContent = i % 3 ? '♥' : '✦';
    bit.style.left = `${box.left + box.width / 2}px`;
    bit.style.top = `${box.top + box.height / 2}px`;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * distance)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * distance)}px`);
    document.body.append(bit);
    setTimeout(() => bit.remove(), 800);
  }
  music.chime('chapter');
  setTimeout(() => {
    removeCoach();
    document.querySelector('[name=answer]:checked, [name=answer]')?.focus({preventScroll:true});
  }, 480);
}
function removeCoach() {
  const coach = document.getElementById('coach');
  if (!coach) return;
  if (!coach.classList.contains('closing')) coach.cleanup();
  coach.remove();
  document.querySelector('.coach-backdrop')?.remove();
  document.querySelectorAll('.coach-pin').forEach(pin => pin.remove());
  document.querySelectorAll('.coach-spot').forEach(node => node.classList.remove('coach-spot'));
  document.documentElement.classList.remove('coach-open');
}

function quizForm() {
  const question = config.questions[questionIndex];
  return `<div class="quiz-top"><span class="small-label">${e(question.chapter)}</span><span>Question ${questionIndex + 1} of 15</span></div>
    <h1 id="question-title">${e(question.text)}</h1><fieldset aria-labelledby="question-title"><div class="answer-list" id="answer-list">${question.options.map((option,i) => `<label class="answer-choice"><input type="radio" name="answer" value="${i + 1}" required${checked(profile.answers[question.id] === i + 1)}><span class="answer-letter" aria-hidden="true">${'ABCD'[i]}</span><span>${e(option)}</span></label>`).join('')}</div></fieldset>`;
}

function reviewSection(title, action, text) {
  return `<section class="review-section"><div class="review-heading"><h3>${title}</h3><button type="button" class="text-link" data-action="edit" data-step="${action}" aria-label="Edit ${title.toLowerCase()}">Edit</button></div><p>${text}</p></section>`;
}
function reviewForm() {
  return `<div class="eyebrow">0${activeStages().length} / All coming together</div><h1>Looking very you.</h1><p class="subtext">One last look before your first introductions.</p>
    ${reviewSection('About you','about',`${e(profile.name)}, ${profile.age || 'add age'} · ${e(profile.city || 'add city')}<br>${e(config.genders[profile.gender] || 'Choose your gender')}`)}
    ${reviewSection('Your preferences','preferences',`${profile.preferred_genders.length === 4 ? 'Everyone' : profile.preferred_genders.map(g => e(config.preferences[g])).join(', ') || 'Choose who you want to meet'} · ages ${profile.age_min}–${profile.age_max}<br>${e(profile.intention || 'Choose your intention')}`)}
    ${reviewSection('Your personality','personality',`${profile.interests.map(e).join(' · ') || 'Your interests are optional'}${workLine(profile) ? `<br>${e(workLine(profile))}` : ''}${profile.building_toward ? `<br>${e(profile.building_toward)}` : ''}`)}
    ${wantsQuiz() ? reviewSection('Your wavelength','quiz',`${config.questions.filter(q => profile.answers[q.id]).length} of 15 questions answered. Your answers help us find common ground.`) : ''}
    <p class="review-note">Your profile is saved on this laptop for the demo. Completed profiles can appear in other local introductions. Nothing is published online.</p>`;
}

function builder() {
  let content = ({about:aboutForm, preferences:preferencesForm, personality:personalityForm, quiz:quizForm, review:reviewForm})[view]();
  const submitLabel = view === 'review' ? 'Show my matches' : editReturn && view !== 'quiz' ? 'Save changes' : ({about:'Nice to meet you', preferences:'Find my wavelength', personality:'Make it mine', quiz:questionIndex === 14 ? 'See my profile' : 'Continue'})[view];
  content = `<form id="profile-form" class="form-panel ${view === 'quiz' ? 'quiz-panel' : ''}"><div class="error alert alert-danger" id="form-error" role="alert" hidden></div>${content}
    <div class="form-actions"><button type="button" class="btn btn-quiet" data-action="back"><span aria-hidden="true">←</span> Back</button><button class="btn btn-primary" type="submit">${submitLabel} <span aria-hidden="true">→</span></button></div>
    <p class="save-note">Saved on this laptop when you continue.</p></form>`;
  return `<div class="builder">${stepper()}${view === 'quiz' ? `<div class="quiz-stage">${heartTrack()}<div class="quiz-layout">${soundtrackBar()}${content}<p class="chapter-note"><span aria-hidden="true">✳</span> No perfect answers. Just the ones that feel like you.</p><p class="quiz-keys"><button type="button" class="text-link" data-action="quiz-tips"><span aria-hidden="true">♡</span> Show quiz tips</button></p></div></div>` : `<div class="builder-grid">${content}${preview()}</div>`}</div>`;
}

function demoBanner() {
  return demo ? '<div class="demo-banner"><span><strong>A little peek.</strong> You’re exploring as Maya. All sample profiles are fictional; nothing is saved.</span><button class="text-link" data-action="new">Create my own profile →</button></div>' : '';
}
function matchingExplanation() {
  if (!wantsQuiz()) {
    return `<details class="how-it-works"><summary>How matching works</summary><div class="explanation"><p>We look for completed adult profiles in your city, with mutual gender and age preferences and the same relationship intention. Shared interests help us choose introductions and suggest an icebreaker.</p><p>Every local match is mutual, with up to three active matches per person. Existing eligible matches stay in place. Chat opens once you both choose “I’d like to meet”. You can unmatch two people every seven hours, and we look for the next eligible person with a free place; a replacement may not be available yet. Blocking is always free. Your relationship type can change once a month, and changing it refreshes your matches automatically. Fictional previews can fill spare introduction slots, but cannot chat or be unmatched.</p><p>The compatibility quiz, answer-alignment scores, and commitment-score filter apply only to long-term relationships. They aren't used for your current intention, even if you have previously saved quiz answers.</p></div></details>`;
  }
  return `<details class="how-it-works"><summary>How matching works</summary><div class="explanation"><p>First, we look for completed adult profiles in your city, with mutual gender and age preferences, the same relationship intention, and commitment scores no more than one point apart.</p><p>Once both local profiles finish the quiz, we automatically form mutual matches, best score first. Everyone has space for up to three active matches, and we make sure people with no match yet are considered first. Existing eligible matches stay in place. Chat opens once you both choose “I’d like to meet”.</p><p>Real connections take time, so you can unmatch two people every seven hours. Each unmatch is replaced straight away when someone is available. Blocking or reporting is always free. Your relationship type can change once a month, and changing it refreshes your matches automatically, without using an unmatch. Saved conversations stay in Messages, with ended conversations read-only. Fictional previews can fill spare introduction slots, but cannot chat or be unmatched.</p><p>Your score out of 100 has three parts. Six areas (sharing support, communication, changing plans, making plans, trying new things and relationship pace) give up to 10 points each for similar answers. The two values questions add 10 points each when your choices agree. Care fit adds up to 20 points: if someone looks for reassurance, a partner who loves to show up for people earns the full points. Interests help start conversations but don't change this score.</p><p>This is answer alignment, not a prediction of relationship success. The quiz is a course-project heuristic, not a psychological assessment.</p></div></details>`;
}

function unmatchPolicy() {
  return matchStatus?.unmatch_policy || results?.unmatch_policy;
}

function unmatchTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
}

function unmatchAllowance({showCount = false} = {}) {
  const policy = unmatchPolicy();
  if (demo || !policy) return '';
  const active = matchStatus?.active_match_count ?? (results?.matches || []).filter(match => match.auto_matched).length;
  const availableAt = policy.next_available_at ? unmatchTime(policy.next_available_at) : '';
  return `<section class="unmatch-allowance" aria-label="Match and unmatch allowance"><div>${showCount ? `<p class="small-label">${active} of 3 active matches</p><h2>A little space to connect.</h2><p>Take time with up to three people. Give each one a real chance before you decide. Real connections take time.</p>` : ''}<p class="allowance-count" role="status"><strong>${policy.remaining} of ${policy.limit} unmatches available</strong> · Rolling ${policy.window_hours}-hour limit</p><p class="field-note">Everyone gets ${policy.limit} unmatches every ${policy.window_hours} hours, because real connections take time. Each one becomes available again ${policy.window_hours} hours after you use it.${availableAt ? ` ${policy.remaining === 0 ? 'You can unmatch again from' : 'Your next allowance returns at'} <time datetime="${e(policy.next_available_at)}">${e(availableAt)}</time>.` : ''}</p></div>${button('Refresh availability','refresh-unmatch-status')}</section>`;
}

function unmatchPage() {
  if (!pendingUnmatch) return matchesPage();
  const policy = unmatchPolicy();
  const available = policy && policy.remaining > 0;
  return `<div class="profile-page unmatch-page"><section class="form-panel"><div class="eyebrow">Make room for the right connection</div><h1>Unmatch ${e(pendingUnmatch.name)}?</h1><p class="subtext">Sometimes you just don’t vibe. It’s okay to move on.</p><div class="notice"><p>This ends the match for both of you. You won’t be matched with each other again.</p><p>Any saved conversation stays in Messages as read-only. Neither person can send more messages.</p><p>We’ll look for the next eligible person with a free place, keeping you at a maximum of three active matches. If no one is available, your place stays open.</p></div><p class="unmatch-reason"><span class="small-label">Reason</span> We didn’t vibe</p>${unmatchAllowance()}${!available ? '<p class="notice" role="status">Your unmatch allowance is used up for now. Refresh availability after the time shown above.</p>' : ''}<div class="form-actions">${button('Keep connection','cancel-unmatch',true)}<button type="button" class="btn btn-danger" data-action="confirm-unmatch" ${available ? '' : 'disabled'}>Unmatch ${e(pendingUnmatch.name)}</button></div></section></div>`;
}
function meetLine(match) {
  if (!match.auto_matched || demo) return 'Fictional sample · Preview only';
  if (match.meet_status === 'mutual') return 'You both want to meet · Chat is open';
  if (match.meet_status === 'waiting') return `You’d like to meet · Waiting for ${e(match.profile.name)}`;
  return 'Matched on your wavelength · Would you like to meet?';
}

function meetPanel(match) {
  if (!match.auto_matched || demo) return '';
  const name = e(match.profile.name);
  if (match.meet_status === 'mutual') return '<p class="notice"><strong>You both want to meet.</strong> Your chat is open. Say hello whenever you’re ready.</p>';
  // Both profiles live on this laptop, so offer the way forward instead of a dead end.
  if (match.meet_status === 'waiting') return `<div class="notice"><p><strong>You’d like to meet ${name}.</strong> We’ll open the chat if they feel the same. Their choice stays private until then.</p><p class="field-note">Showing both sides? Switch to ${name} to answer.</p><div class="inline-actions">${button(`Switch to ${name} <span aria-hidden="true">⇄</span>`,'meet-switch',false,`data-id="${e(match.profile.id)}"`)}</div></div>`;
  return `<div class="notice"><p><strong>You’re matched on your wavelength.</strong> Take a moment with what you share. Chat opens once you both choose “I’d like to meet”.</p><div class="inline-actions">${button(`I’d like to meet ${name}`,'meet',true,`data-id="${e(match.profile.id)}"`)}</div></div>`;
}

function wavelengthPage() {
  const w = results?.wavelength;
  if (!w) return matchesPage();
  return `<div class="profile-page wavelength-page"><section class="form-panel"><div class="eyebrow">Your wavelength · ${e(w.name)} attachment style</div><h1>${e(w.title)}.</h1><p class="subtext">${e(w.text)}</p>
    <section class="detail-section"><h2>What you bring</h2>${w.strengths.map(item => `<div class="reason-row"><span class="reason-icon" aria-hidden="true">✦</span><div><p>${e(item)}</p></div></div>`).join('')}</section>
    <section class="detail-section"><h2>Who helps you feel at home</h2><p>${e(w.partner)}</p><p class="field-note">What matters most to you: ${e(w.core_value)}.</p></section>
    <p class="notice">${e(w.note)}</p>
    <div class="form-actions">${button('Meet your introductions <span aria-hidden="true">→</span>','show-matches',true)}</div></section></div>`;
}

function confirmTypePage() {
  if (!pendingTypeChange) return matchesPage();
  const from = e(pendingTypeChange.from), to = e(pendingTypeChange.to);
  const lockedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString([], {day:'numeric', month:'long', year:'numeric'});
  const count = pendingTypeChange.matches;
  return `<div class="profile-page unmatch-page"><section class="form-panel"><div class="eyebrow">A real decision</div><h1>Switch to ${to}?</h1><p class="subtext">HardLaunch is for people looking for a genuine match. Please make sure this is what you want.</p><div class="notice"><p><strong>Your relationship type can change only once a month.</strong> After this, it stays as ${to} until ${e(lockedUntil)}. You won’t be able to switch back to ${from} before then.</p><p>${count ? `Your ${count} current match${count === 1 ? '' : 'es'} will end, and your matches will be refreshed automatically. This does not use an unmatch.` : 'Your matches will be refreshed automatically. This does not use an unmatch.'} Saved chats stay in Messages as read-only.</p></div><p class="field-note">Not sure yet? Keep your current type and take your time.</p>
    <div class="form-actions">${button(`Keep ${from}`,'cancel-type-change',true)}<button type="button" class="btn btn-danger" data-action="confirm-type-change">Yes, switch to ${to}</button></div></section></div>`;
}

function blockPage() {
  if (!pendingBlock) return matchesPage();
  const name = e(pendingBlock.name);
  return `<div class="profile-page unmatch-page"><section class="form-panel"><div class="eyebrow">Your safety comes first</div><h1>Block ${name}?</h1><p class="subtext">If something felt wrong, you don’t need a reason. Blocking is always free and never uses your unmatches.</p><div class="notice"><p>This ends the match for both of you, and you won’t be matched again. ${name} will only see that the connection ended.</p><p>Any saved conversation stays in Messages as read-only.</p></div>
    <label class="choice"><input type="checkbox" class="form-check-input" id="block-report"><span>Also report this profile for review</span></label><p class="field-note">In this demo, reports are saved on this laptop. A real app would send them to a safety team.</p>
    <div class="form-actions">${button('Keep connection','cancel-block',true)}<button type="button" class="btn btn-danger" data-action="confirm-block">Block ${name}</button></div></section></div>`;
}

function matchCard(match, index) {
  const person = match.profile;
  return `<article class="match-card"><div class="match-art tone-${e(person.avatar)}">${portrait(person)}<span class="match-number">INTRODUCTION ${String(index + 1).padStart(2, '0')}</span>${match.score !== null ? `<div class="alignment"><strong>${e(match.score_label)}</strong><span>Answer alignment</span></div>` : '<div class="alignment"><span>Same city · Shared intention</span></div>'}</div>
    <div class="match-body"><h2>${e(person.name)}, ${person.age}</h2><p class="profile-meta">${e(person.city)}${person.pronouns ? ` · ${e(person.pronouns)}` : ''}</p>${workLine(person) ? `<p class="profile-work">${e(workLine(person))}</p>` : ''}<p class="match-quote">${e(person.building_toward || 'There’s a whole person behind these answers. Start with a hello.')}</p>
    <div class="reason-tags">${match.reasons.slice(0,2).map(reason => `<span>${e(reason.title)}</span>`).join('')}</div>
    <p class="match-availability">${meetLine(match)}</p>
    <button class="btn" data-action="detail" data-id="${e(person.id)}" aria-label="See why you connect with ${e(person.name)}">See why we connect <span aria-hidden="true">↗</span></button></div></article>`;
}
function matchesPage() {
  const matches = results?.matches || [];
  const celebrate = justCompleted;
  justCompleted = false;
  return `<div class="matches-page">${demoBanner()}${celebrate ? '<div class="celebration-strip" role="status"><span aria-hidden="true">✦</span> Profile complete. Here’s to a little possibility.</div>' : ''}
    <div class="matches-heading"><div><div class="eyebrow">Good people. A little common ground.</div><h1>${e(profile.name)}, meet your<br>kind of possibility.</h1><p class="subtext">${matches.length ? `${matches.length} thoughtful introduction${matches.length === 1 ? '' : 's'} in ${e(profile.city)}. A place to start something.` : `Let's find your people in ${e(profile.city)}.`}</p></div>${button('Your preferences <span aria-hidden="true">↗</span>','edit-preferences')}</div>
    <div class="filter-pills"><span class="pill">⌁ ${e(profile.city)}</span><span class="pill">${e(profile.intention)}</span><span class="pill">Ages ${profile.age_min}–${profile.age_max}</span><span class="pill">${profile.preferred_genders.length === 4 ? 'Open to all genders' : profile.preferred_genders.map(g => e(config.preferences[g])).join(', ')}</span></div>
    ${!demo ? '<p class="review-note">Every local match is mutual. Chat opens once you both choose “I’d like to meet”. You each have space for up to three active connections, whatever your intention.</p>' : ''}
    ${unmatchAllowance({showCount:true})}
    ${matches.length ? `<div class="match-grid row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4 ${celebrate ? 'celebrate' : ''}">${matches.map((match, i) => `<div class="col">${matchCard(match, i)}</div>`).join('')}</div><div class="match-explainer"><p>A little common ground, not a promise. The best part is getting to know each other.</p><span>Up to 3 thoughtful introductions.</span></div>` : `<div class="empty-state">${avatar('cloud')}<h2>Your people are worth the wait.</h2><p>No introductions are available right now. Matches need mutual preferences${wantsQuiz() ? ', completed quizzes' : ''} and space in both people’s three matches. You can edit your preferences, or keep them just as they are. We haven't widened anything for you.</p>${button('Edit preferences','edit-preferences',true)}</div>`}
    ${matchingExplanation()}</div>`;
}
function detailPage() {
  const match = results.matches.find(item => item.profile.id === detailId);
  if (!match) return matchesPage();
  return `<div class="detail-page">${demoBanner()}<div class="detail-top">${button('← Your introductions','matches')}</div><div class="detail-grid">${profileCard(match.profile)}<div class="detail-content"><div class="eyebrow">A little common ground</div><h1>You + ${e(match.profile.name)}</h1>${match.score !== null ? `<div class="detail-score"><div class="score-number">${match.score}<small>/100</small></div><div><strong>${e(match.score_label)}</strong><p>Answer alignment: a comparison of your quiz answers, not a prediction of relationship success.</p></div></div>` : '<div class="detail-score"><div><strong>Same city. Shared intention.</strong><p>An introduction based on your mutual preferences and interests.</p></div></div>'}
    ${meetPanel(match)}
    <section class="detail-section"><h2>What clicks</h2>${match.reasons.map(reason => `<div class="reason-row"><span class="reason-icon" aria-hidden="true">↗</span><div><h3>${e(reason.title)}</h3><p>${e(reason.text)}</p></div></div>`).join('')}</section>
    <section class="detail-section"><h2>Something to explore</h2><div class="explore-box"><p>${e(match.explore.text)}</p>${match.explore.yours ? `<div class="comparison"><div><strong>You</strong>${e(match.explore.yours)}</div><div><strong>${e(match.profile.name)}</strong>${e(match.explore.theirs)}</div></div>` : ''}</div></section>
    <section class="icebreaker"><div class="small-label">A first hello, sorted</div><h2>Break the ice.</h2><p id="icebreaker-text">${e(match.icebreaker)}</p><div class="inline-actions">${button('Copy icebreaker','copy')}${match.can_chat && !demo ? button('Start conversation →','start-chat',true,`data-id="${e(match.profile.id)}"`) : ''}</div><small>${match.can_chat && !demo ? 'Your messages stay on this laptop. Switch profiles to show the other side.' : match.auto_matched && !demo ? 'Save it for when you both choose “I’d like to meet”.' : 'Fictional sample · preview only. Use two local profiles to try a conversation.'}</small></section>
    ${match.auto_matched && match.can_unmatch && !demo ? `<div class="unmatch-actions">${button('We didn’t vibe · Unmatch','unmatch',false,`data-id="${e(match.profile.id)}"`)}${button('Block or report','block',false,`data-id="${e(match.profile.id)}"`)}<p class="field-note">Review what happens before you decide.</p></div>` : ''}
    </div></div>${matchingExplanation()}</div>`;
}

function myProfile() {
  return `<div class="profile-page">${demoBanner()}<div class="eyebrow">Your little corner</div><h1>A lot more you.</h1><div class="builder-grid"><div id="live-profile">${profileCard()}</div><section class="form-panel"><h2>Your profile, your pace.</h2><p class="subtext">${wantsQuiz() ? 'Change the details, revisit your answers, or adjust who you\'d like to meet.' : 'Change the details or adjust who you\'d like to meet.'}</p>
    ${!demo ? `<form id="photo-form" class="photo-edit"><h3>Your picture</h3><p class="field-note">Upload or replace your photo, or switch to an avatar. Save when it feels like you.</p>${pictureFields()}<div class="inline-actions"><button class="btn btn-primary" type="submit">Save picture</button>${button('Cancel changes','cancel-photo')}</div></form>` : ''}
    ${reviewSection('About you','about',`${e(profile.name)}, ${profile.age} · ${e(profile.city)}`)}${reviewSection('Personality','personality',profile.interests.map(e).join(' · ') || 'Add a few favourite things')}${wantsQuiz() ? reviewSection('Your wavelength','quiz','15 questions. Revisit any answer.') : ''}
    <div class="form-actions">${wantsQuiz() ? button('Your wavelength','wavelength') : ''}${button('Edit preferences','edit-preferences')}${button('View matches','matches',true)}</div><p class="review-note">${demo ? 'This sample profile is read-only. Create your own to try the full journey.' : 'Saved on this laptop. Your private preferences and full quiz answers are not shown on your profile card.'}</p>${!demo ? `<div class="profile-delete-actions">${button('Delete this profile','delete-profile',false,`data-id="${e(profile.id)}"`)}<p class="field-note">Review what will be removed before confirming.</p></div>` : ''}</section></div></div>`;
}

function deleteProfilePage() {
  return `<div class="profile-page delete-page"><section class="form-panel"><div class="eyebrow">Manage this local profile</div><h1>Delete ${e(pendingDelete.name || 'this unfinished profile')}?</h1><p class="subtext">This permanently removes this profile, its picture, preferences and quiz answers from this laptop.</p><p class="notice">All conversations involving ${e(pendingDelete.name || 'this profile')}, including both people’s messages, will also be removed. Other profiles and their remaining conversations will stay. This cannot be undone.</p><div class="form-actions">${button('Keep profile','cancel-delete',true)}<button type="button" class="btn btn-danger" data-action="confirm-delete">Delete profile</button></div></section></div>`;
}

function profilesPage() {
  const loggedOut = !profile;
  return `<div class="profile-page">${loggedOut ? '<div class="eyebrow">Logged out</div><h1>Who’s using HardLaunch?</h1><p class="subtext">Choose a profile to log in. One click, no password: this is a local proof of concept, so anyone using this laptop can open any profile.</p>' : '<div class="eyebrow">Your presentation, made easy</div><h1>A few different people.</h1><p class="subtext">Create and switch profiles on this laptop. Everyone using this demo can switch between them; these are local demo profiles, without accounts or passwords.</p>'}
    <div class="local-demo-callout"><div><h2>Show both sides of a hello.</h2><p>Avery and Jordan are fictional casual dating profiles with matching preferences. Create them once, then keep using their saved conversation.</p></div>${button('Open Avery + Jordan','demo-pair')}</div>
    <div class="page-actions">${button('Create a new profile +','new',true)}</div>
    <div class="local-profile-grid row row-cols-1 row-cols-lg-2 g-3">${savedProfiles.map(person => `<div class="col"><article class="local-profile"><div class="person-icon">${portrait(person)}</div><div><h2>${e(person.name || 'Unfinished profile')}${person.age ? `, ${person.age}` : ''}</h2><p>${e(person.city || 'City to come')} · ${person.status === 'complete' ? 'Ready to meet' : 'Profile in progress'}</p><p>${e(person.intention || 'Choose an intention')}</p>${workLine(person) ? `<p>${e(workLine(person))}</p>` : ''}</div>${button((person.id === profile?.id ? 'Continue as ' : loggedOut ? 'Log in as ' : 'Switch to ')+e(person.name || 'this profile'),'switch-profile',false,`data-id="${e(person.id)}"`)}<button class="text-link delete-link" data-action="delete-profile" data-id="${e(person.id)}" aria-label="Delete ${e(person.name || 'unfinished profile')}">Delete profile</button></article></div>`).join('')}</div>
    ${!savedProfiles.length ? '<p class="notice">No local profiles yet. Create your own or try the prepared pair.</p>' : ''}</div>`;
}

function messagesPage() {
  return `<div class="profile-page"><div class="eyebrow">A little hello goes a long way</div><h1>${e(profile.name)}’s conversations.</h1><p class="subtext">Messages are saved on this laptop. Open a conversation, or meet someone through your introductions.</p>
    <div class="conversation-list">${conversations.map(item => { const last = item.messages[item.messages.length - 1]; return `<button class="conversation-row" data-action="open-chat" data-id="${e(item.id)}"><span class="person-icon">${portrait(item.other)}</span><span><strong>${e(item.other.name)}</strong>${item.unmatched ? '<span class="conversation-state">Unmatched · Read-only</span>' : ''}<span>${last ? `${last.sender_id === profile.id ? 'You: ' : ''}${e(last.text)}` : item.unmatched ? 'No saved messages.' : 'Your first hello is waiting.'}</span></span><span aria-hidden="true">→</span></button>`; }).join('')}</div>
    ${!conversations.length ? `<div class="empty-state">${avatar('peach')}<h2>Every conversation starts somewhere.</h2><p>When you and a match both choose “I’d like to meet”, your chat opens here. Sample previews cannot reply.</p>${button('Meet your matches','matches',true)}</div>` : ''}</div>`;
}

function chatPage() {
  const other = conversation.other;
  return `<div class="chat-page"><div class="chat-toolbar">${button('← Conversations','messages')}${button('Refresh messages','refresh-chat')}</div>
    <section class="chat-panel" aria-label="Conversation with ${e(other.name)}"><div class="chat-heading"><span class="person-icon">${portrait(other)}</span><div><h1>You + ${e(other.name)}</h1><p>Sending as <strong>${e(profile.name)}</strong> · Local demo</p></div></div>
    <div id="message-history" class="message-history" role="log" aria-label="Saved messages"><p class="chat-intro">A little common ground. A good place to start.</p>${conversation.messages.map(message => `<article class="message ${message.sender_id === profile.id ? 'from-me' : 'from-them'}"><div class="message-label">${message.sender_id === profile.id ? 'You' : e(other.name)}</div><p>${e(message.text)}</p><time datetime="${e(message.sent_at)}">${e(new Date(message.sent_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}))}</time></article>`).join('')}${!conversation.messages.length ? '<p class="chat-empty">No messages yet. Say a little hello.</p>' : ''}</div>
    ${conversation.can_send ? `<form id="message-form" class="message-composer"><div class="field"><label for="message-text">Your message to ${e(other.name)}</label><textarea class="form-control" id="message-text" name="message" required maxlength="1000" rows="3" placeholder="Start with something you have in common…"></textarea></div><button class="btn btn-primary" type="submit">Send message →</button><p class="field-note">Up to 1,000 characters. Saved when you send.</p></form>` : `<p class="notice" role="status">${conversation.unmatched ? '<strong>Unmatched · Read-only conversation.</strong> This connection has ended. You can both read your saved messages, but neither person can send more.' : e(conversation.unavailable_reason || 'This connection is no longer active. Your saved conversation is read-only.')}</p>`}</section>
    ${conversation.can_unmatch && conversation.is_active_match && !demo ? `<div class="unmatch-actions">${button('We didn’t vibe · Unmatch','unmatch',false,`data-id="${e(other.id)}"`)}${button('Block or report','block',false,`data-id="${e(other.id)}"`)}<p class="field-note">Review what happens before you decide.</p></div>` : ''}
    <div class="local-demo-callout"><div><h2>Now show the other side.</h2><p>Switch to ${e(other.name)} to read this conversation${conversation.can_send ? ' and reply' : ''}. No automatic or simulated replies.</p></div>${button('Switch to '+e(other.name),'chat-switch',false,`data-id="${e(other.id)}"`)}</div></div>`;
}

async function selectProfile(id) {
  session = await api('/api/select', {id});
  profile = session.profile; demo = false; results = null; editReturn = null;
  matchStatus = null; pendingUnmatch = null;
  questionIndex = session.question_index || 0;
}

async function openConversation(id) {
  conversation = await api(`/api/conversations/${encodeURIComponent(id)}?profile_id=${encodeURIComponent(profile.id)}`);
  go('chat');
}

async function refreshMatchStatus() {
  const status = await api(`/api/match-status?profile_id=${encodeURIComponent(profile.id)}`);
  matchStatus = status.unmatch_policy ? status : {unmatch_policy:status, active_match_count:status.active_match_count};
  if (results) results.unmatch_policy = matchStatus.unmatch_policy;
}

async function sendMessage() {
  const input = document.getElementById('message-text');
  conversation = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {profile_id:profile.id, text:input.value});
  go('chat', false);
  document.getElementById('message-text')?.focus();
  toast('Message sent as '+profile.name+'.');
}

async function choosePhoto(file) {
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > config.photo_max_bytes) throw new Error('Choose a JPEG, PNG or WebP photo no larger than 2 MB.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The photo could not be read. Please choose it again.'));
    reader.readAsDataURL(file);
  });
  await new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = () => reject(new Error('That photo cannot be displayed. Please choose another image.')); img.src = data; });
  profile.photo = data;
  document.querySelectorAll('[name=avatar]').forEach(node => node.checked = false);
  document.getElementById('photo-status').textContent = 'Your photo is selected. Pick an avatar to replace it.';
  document.getElementById('live-profile').innerHTML = profileCard();
}

async function savePicture() {
  if (demo) return;
  session = await api('/api/complete', {profile});
  profile = session.profile;
  results = null;
  go('my-profile', false);
  toast('Your profile picture is saved.');
}

function readForm() {
  const form = document.getElementById('profile-form');
  if (!form || view === 'review') return;
  const values = new FormData(form);
  if (view === 'about') {
    for (const key of ['name','city','gender','pronouns','identity_text']) profile[key] = values.get(key) || '';
    profile.avatar = values.get('avatar') || profile.avatar || 'sun';
    profile.age = Number(values.get('age') || 0);
  } else if (view === 'preferences') {
    profile.preferred_genders = values.getAll('preferred_genders');
    profile.age_min = Number(values.get('age_min') || 0);
    profile.age_max = Number(values.get('age_max') || 0);
    profile.intention = values.get('intention') || '';
  } else if (view === 'personality') {
    profile.role = values.get('role') || '';
    profile.company = values.get('company') || '';
    profile.interests = values.getAll('interests');
    profile.prompt = values.get('prompt');
    profile.building_toward = values.get('building_toward') || '';
  } else if (view === 'quiz' && values.get('answer')) {
    profile.answers[config.questions[questionIndex].id] = Number(values.get('answer'));
  }
}

function refreshedMessage() {
  if (!session?.matches_refreshed) return '';
  return 'You changed your relationship type, so your matches are being refreshed automatically. No unmatches were used.';
}
// A completed profile changing relationship type must confirm first: it then stays locked for a month.
function needsTypeConfirm() {
  const saved = session?.profile;
  return !demo && !typeChangeConfirmed && saved?.status === 'complete' && saved.intention !== '' && profile.intention !== saved.intention;
}
async function saveDraft(next, index = questionIndex) {
  const confirmed = typeChangeConfirmed;
  typeChangeConfirmed = false;
  session = await api('/api/draft', {profile, step:next, question_index:index, confirm_type_change:confirmed});
  profile = session.profile;
  if (refreshedMessage()) { results = null; toast(refreshedMessage()); }
}
async function loadResults() {
  results = await api(demo ? '/api/demo' : '/api/matches');
  profile = results.profile;
  matchStatus = results.unmatch_policy ? {unmatch_policy:results.unmatch_policy, active_match_count:results.matches.filter(match => match.auto_matched).length} : null;
  pendingUnmatch = null;
  go('matches');
}
async function submitProfile() {
  if (needsQuiz()) {
    questionIndex = config.questions.findIndex(q => ![1, 2, 3, 4].includes(profile.answers[q.id]));
    await saveDraft('quiz');
    editReturn = null;
    go('quiz');
    toast(`${refreshedMessage()} For long-term relationships, finish your compatibility quiz before meeting your matches.`.trim());
    return;
  }
  const confirmed = typeChangeConfirmed;
  typeChangeConfirmed = false;
  session = await api('/api/complete', {profile, confirm_type_change:confirmed});
  profile = session.profile;
  justCompleted = !editReturn;
  editReturn = null;
  await loadResults();
  if (refreshedMessage()) toast(refreshedMessage());
  // Straight after the 15 questions, show what the quiz says before the introductions.
  if (quizJustFinished && results.wavelength) {
    quizJustFinished = false;
    justCompleted = true;
    go('wavelength');
  }
}
async function submitStep() {
  readForm();
  if (view === 'preferences' && !profile.preferred_genders.length) throw new Error('Choose at least one gender, or Everyone.');
  if (view === 'preferences' && needsTypeConfirm()) {
    pendingTypeChange = {from:session.profile.intention, to:profile.intention, matches:(results?.matches || []).filter(match => match.auto_matched).length};
    return go('confirm-type');
  }
  if (view === 'review' || (view === 'preferences' && editReturn === 'matches')) return submitProfile();
  if (view === 'quiz') {
    if (!profile.answers[config.questions[questionIndex].id]) throw new Error('Choose the answer that feels most like you.');
    const next = questionIndex === 14 ? 'review' : 'quiz';
    const index = Math.min(questionIndex + 1, 14);
    await saveDraft(next, index);
    if (next === 'review') quizJustFinished = true;
    if (next === 'quiz' && index % 3 === 0) toast(`${config.questions[questionIndex].chapter} complete. A little more you.`);
    questionIndex = index;
    go(next);
  } else {
    const visible = activeStages();
    const next = editReturn || visible[visible.indexOf(view) + 1];
    await saveDraft(next, next === 'quiz' ? 0 : questionIndex);
    if (next === 'quiz') questionIndex = 0;
    editReturn = null;
    go(next);
  }
}

async function perform(action, target) {
  if (action === 'show-matches') return go('matches');
  if (action === 'replay-intro') return playIntro();
  if (action === 'music-toggle') {
    if (music.playing) music.pause(); else await music.play();
    return refreshSoundtrack(musicFocus());
  }
  if (action === 'spotify-edit') { music.spotifyEditing = true; return refreshSoundtrack('spotify-link'); }
  if (action === 'quiz-tips') return showCoach();
  if (action === 'music-file') { document.getElementById('music-file').click(); return; }
  if (action === 'cancel-type-change') {
    profile.intention = pendingTypeChange ? pendingTypeChange.from : profile.intention;
    pendingTypeChange = null;
    return go('preferences');
  }
  if (action === 'confirm-type-change') {
    if (!pendingTypeChange) return;
    const from = pendingTypeChange.from;
    profile.intention = pendingTypeChange.to;
    pendingTypeChange = null;
    typeChangeConfirmed = true;
    view = 'preferences';
    try {
      return await submitStep();
    } catch (error) {
      // For example, the type was already changed this month: keep the saved type.
      profile.intention = from;
      go('preferences');
      throw error;
    }
  }
  if (action === 'wavelength') {
    if (!results) await loadResults();
    return go('wavelength');
  }
  if (action === 'meet') {
    if (demo) { toast('Sample previews are read-only.'); return; }
    results = await api('/api/meet', {profile_id:profile.id, other_id:target.dataset.id});
    profile = results.profile;
    const match = results.matches.find(item => item.profile.id === target.dataset.id);
    go(view, false);
    toast(match?.meet_status === 'mutual' ? `You both want to meet. Your chat with ${match.profile.name} is open.` : 'Lovely. We’ll open the chat if they feel the same.');
    return;
  }
  if (action === 'meet-switch') {
    // Open the other person's view of this same match, ready for their answer.
    const me = profile.id;
    await selectProfile(target.dataset.id);
    await loadResults();
    if (!results.matches.some(item => item.profile.id === me)) return;
    detailId = me;
    go('detail');
    toast(`You’re now ${profile.name}. Choose “I’d like to meet” to open the chat.`);
    return;
  }
  if (action === 'block') {
    if (demo) { toast('Sample previews cannot be blocked.'); return; }
    let person;
    if (view === 'chat' && conversation?.is_active_match && conversation.other.id === target.dataset.id) person = conversation.other;
    if (view === 'detail') {
      const match = results?.matches.find(item => item.profile.id === target.dataset.id);
      if (match?.auto_matched) person = match.profile;
    }
    if (!person) throw new Error('Only an active local match can be blocked. Refresh your introductions to continue.');
    pendingBlock = {id:person.id, name:person.name, profile_id:profile.id};
    blockReturn = view;
    return go('block');
  }
  if (action === 'cancel-block') {
    pendingBlock = null;
    if (blockReturn === 'chat') return openConversation(conversation.id);
    return go(blockReturn);
  }
  if (action === 'confirm-block') {
    if (demo || view !== 'block' || !pendingBlock || pendingBlock.profile_id !== profile.id) return;
    const report = document.getElementById('block-report')?.checked === true;
    const name = pendingBlock.name;
    results = await api('/api/block', {profile_id:profile.id, other_id:pendingBlock.id, report, confirm:true});
    profile = results.profile;
    matchStatus = {unmatch_policy:results.unmatch_policy, active_match_count:results.active_match_count};
    pendingBlock = null;
    go('matches');
    toast(report ? `${name} is blocked and reported. Thank you for telling us.` : `${name} is blocked.`);
    return;
  }
  if (action === 'unmatch') {
    if (demo) { toast('Sample previews cannot be unmatched.'); return; }
    let person;
    if (view === 'chat' && conversation?.can_unmatch && conversation.is_active_match && conversation.other.id === target.dataset.id) person = conversation.other;
    if (view === 'detail') {
      const match = results?.matches.find(item => item.profile.id === target.dataset.id);
      if (match?.auto_matched && match.can_unmatch) person = match.profile;
    }
    if (!person) throw new Error('Only an active local match can be unmatched. Refresh your introductions to continue.');
    await refreshMatchStatus();
    pendingUnmatch = {id:person.id, name:person.name, profile_id:profile.id, draft:view === 'chat' ? document.getElementById('message-text')?.value || '' : ''};
    unmatchReturn = view;
    return go('unmatch');
  }
  if (action === 'cancel-unmatch') {
    const draft = pendingUnmatch?.draft || '';
    pendingUnmatch = null;
    if (unmatchReturn === 'chat') {
      await openConversation(conversation.id);
      const input = document.getElementById('message-text');
      if (input && conversation.can_send) input.value = draft;
      return;
    }
    return go(unmatchReturn);
  }
  if (action === 'refresh-unmatch-status') {
    if (demo || !profile) return;
    if (view === 'matches') return loadResults();
    await refreshMatchStatus();
    go(view, false);
    toast('Unmatch availability updated.');
    return;
  }
  if (action === 'confirm-unmatch') {
    if (demo || view !== 'unmatch' || !pendingUnmatch || pendingUnmatch.profile_id !== profile.id) return;
    const policy = unmatchPolicy();
    if (!policy || policy.remaining <= 0) {
      toast('Your allowance is used up. Refresh availability after the time shown.');
      return;
    }
    const name = pendingUnmatch.name;
    try {
      results = await api('/api/unmatch', {profile_id:profile.id, other_id:pendingUnmatch.id, reason:'did_not_vibe', confirm:true});
    } catch (error) {
      if (error.unmatch_policy) {
        matchStatus = {...matchStatus, unmatch_policy:error.unmatch_policy};
        go('unmatch', false);
      }
      throw error;
    }
    profile = results.profile;
    matchStatus = {unmatch_policy:results.unmatch_policy, active_match_count:results.matches.filter(match => match.auto_matched).length};
    pendingUnmatch = null;
    go('matches');
    toast(`You’ve unmatched ${name}. Your introductions are up to date.`);
    return;
  }
  if (action === 'cancel-photo') {
    const saved = await api('/api/session');
    if (!saved || saved.profile.id !== profile.id) throw new Error('Another profile is active. Open Profiles to continue.');
    session = saved; profile = saved.profile;
    return go('my-profile', false);
  }
  if (action === 'delete-profile') {
    if (demo) { toast('Sample previews are read-only.'); return; }
    const person = view === 'my-profile' ? profile : savedProfiles.find(person => person.id === target.dataset.id);
    if (!person) throw new Error('That profile was not found. Reopen Profiles to refresh the list.');
    pendingDelete = {id:person.id, name:person.name};
    deleteReturn = view === 'my-profile' ? 'my-profile' : 'profiles';
    return go('delete-profile');
  }
  if (action === 'cancel-delete') {
    pendingDelete = null;
    return go(deleteReturn);
  }
  if (action === 'confirm-delete') {
    if (!pendingDelete || view !== 'delete-profile' || demo) return;
    const deleted = await api('/api/delete-profile', {id:pendingDelete.id, confirm:true});
    session = deleted.session; profile = session?.profile; results = null;
    conversations = []; conversation = null; pendingDelete = null; editReturn = null;
    savedProfiles = await api('/api/profiles');
    go('profiles');
    toast(`${deleted.deleted_name || 'The unfinished profile'} has been deleted.`);
    return;
  }
  if (action === 'logout') {
    if (stages.includes(view) && !demo) { readForm(); await saveDraft(view); }
    const name = profile?.name;
    await api('/api/logout', {});
    session = null; profile = null; demo = false; results = null; editReturn = null; matchStatus = null;
    conversations = []; conversation = null;
    pendingUnmatch = pendingBlock = pendingDelete = pendingTypeChange = null;
    savedProfiles = await api('/api/profiles');
    go('profiles');
    toast(`${name || 'You'} logged out. Your profile and progress are saved. Pick a profile to log back in.`);
    return;
  }
  if (action === 'profiles') {
    if (stages.includes(view) && !demo) { readForm(); await saveDraft(view); }
    session = await api('/api/session');
    profile = session?.profile; demo = false; editReturn = null; results = null;
    savedProfiles = await api('/api/profiles');
    return go('profiles');
  }
  if (action === 'demo-pair') {
    session = await api('/api/demo-pair', {});
    profile = session.profile; demo = false; editReturn = null; results = null;
    toast('Avery and Jordan are ready. Open Jordan’s profile to start a conversation.');
    return profile.status === 'complete' ? loadResults() : go('about');
  }
  if (action === 'switch-profile') {
    await selectProfile(target.dataset.id);
    return profile.status === 'complete' ? loadResults() : go(stages.includes(session.step) ? session.step : 'about');
  }
  if (['messages','start-chat','open-chat','refresh-chat','chat-switch'].includes(action) && demo) {
    toast('This preview is read-only. Open Profiles to try a local conversation.'); return;
  }
  if (action === 'messages') {
    conversations = await api(`/api/conversations?profile_id=${encodeURIComponent(profile.id)}`);
    return go('messages');
  }
  if (action === 'start-chat') {
    conversation = await api('/api/conversations', {profile_id:profile.id, other_id:target.dataset.id});
    return go('chat');
  }
  if (action === 'open-chat') return openConversation(target.dataset.id);
  if (action === 'refresh-chat') {
    const draft = document.getElementById('message-text')?.value || '';
    await openConversation(conversation.id);
    const input = document.getElementById('message-text');
    if (input) input.value = draft;
    return;
  }
  if (action === 'chat-switch') {
    const id = conversation.id;
    await selectProfile(target.dataset.id);
    return openConversation(id);
  }
  if (action === 'install') {
    if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderHeader(); }
    return;
  }
  if (action === 'copy') {
    const text = results.matches.find(m => m.profile.id === detailId).icebreaker;
    try { await navigator.clipboard.writeText(text); toast('Icebreaker copied. A good hello is a lovely start.'); }
    catch { const range = document.createRange(); range.selectNodeContents(document.getElementById('icebreaker-text')); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); toast('Text selected. Press Ctrl+C (or Command+C) to copy.'); }
    return;
  }
  if (action === 'new') {
    session = await api('/api/new', {});
    profile = session.profile; demo = false; results = null; questionIndex = 0; editReturn = null;
    return go('about');
  }
  if (action === 'demo') {
    demo = true; editReturn = null;
    return loadResults();
  }
  if (action === 'home') {
    if (stages.includes(view) && !demo) { readForm(); await saveDraft(view); }
    savedProfiles = await api('/api/profiles');
    return go('welcome');
  }
  if (action === 'resume' || action === 'open-saved') {
    if (action === 'open-saved') {
      const id = document.getElementById('saved-profile').value;
      if (!id) throw new Error('Choose a saved profile first.');
      session = await api('/api/select', {id});
    } else session = await api('/api/session');
    if (!session) return go('welcome');
    profile = session.profile; demo = false; editReturn = null; questionIndex = session.question_index || 0;
    return profile.status === 'complete' ? loadResults() : go(stages.includes(session.step) ? session.step : 'about');
  }
  if (action === 'matches') return loadResults();
  if (action === 'my-profile') return go('my-profile');
  if (action === 'detail') { detailId = target.dataset.id; return go('detail'); }
  if (action === 'edit' || action === 'edit-preferences') {
    if (demo) { toast('This sample is read-only. Choose “Create my own profile” to make it yours.'); return; }
    const next = action === 'edit' ? target.dataset.step : 'preferences';
    editReturn = action === 'edit-preferences' ? 'matches' : 'review';
    if (next === 'quiz') questionIndex = 0;
    return go(next);
  }
  if (action === 'back') {
    readForm();
    let next;
    if (view === 'about') next = 'welcome';
    else if (view === 'quiz' && questionIndex > 0) { questionIndex--; next = 'quiz'; }
    else { const visible = activeStages(); next = visible[visible.indexOf(view) - 1]; }
    if (editReturn && view !== 'quiz') { next = 'review'; editReturn = null; }
    await saveDraft(next === 'welcome' ? 'about' : next);
    return go(next);
  }
}

async function safely(work) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button')].filter(node => !node.disabled);
  controls.forEach(node => node.disabled = true);
  try { await work(); }
  catch (error) { showError(error); }
  finally { busy = false; controls.forEach(node => node.disabled = false); }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!event.target.closest('#profile-menu')) setProfileMenu(false);
  if (!target) return;
  event.preventDefault();
  if (target.dataset.action === 'profile-menu') {
    // Opened from the keyboard (detail 0): move focus into the menu.
    setProfileMenu(target.getAttribute('aria-expanded') !== 'true', event.detail === 0);
    return;
  }
  if (target.closest('#profile-menu')) setProfileMenu(false);
  safely(() => perform(target.dataset.action, target));
});
// Profile menu keys: arrows move between items, Escape closes and returns focus, Tab closes.
document.addEventListener('keydown', event => {
  const list = document.getElementById('profile-menu-list');
  if (!list || list.hidden) {
    if (event.target.id === 'profile-menu-button' && event.key === 'ArrowDown') { event.preventDefault(); setProfileMenu(true, true); }
    return;
  }
  const items = [...list.querySelectorAll('[role=menuitem]')], index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    setProfileMenu(false);
    document.getElementById('profile-menu-button').focus();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length].focus();
  } else if (event.key === 'Tab') setProfileMenu(false);
});
document.addEventListener('submit', event => {
  if (event.target.id === 'photo-form') { event.preventDefault(); safely(savePicture); return; }
  if (event.target.id === 'message-form') { event.preventDefault(); safely(sendMessage); return; }
  if (event.target.id === 'spotify-form') {
    event.preventDefault();
    const link = document.getElementById('spotify-link').value;
    safely(async () => {
      try {
        await music.useSpotify(link);
        const error = document.getElementById('form-error');
        if (error) error.hidden = true; // Clear an earlier "that isn't a Spotify link".
      } catch (error) { music.spotifyEditing = true; throw error; }
      finally { refreshSoundtrack(musicFocus()); }
    });
    return;
  }
  if (event.target.id !== 'profile-form') return;
  event.preventDefault();
  safely(submitStep);
});
document.addEventListener('input', event => {
  if (event.target.id === 'music-volume') { music.setVolume(Number(event.target.value)); return; }
  if (event.target.closest('#photo-form')) {
    if (event.target.name === 'avatar') {
      profile.avatar = event.target.value; profile.photo = '';
      document.getElementById('photo').value = '';
      document.getElementById('photo-status').textContent = 'Your avatar is selected. Choose Save picture to keep this change.';
      document.getElementById('live-profile').innerHTML = profileCard();
    }
    return;
  }
  if (!event.target.closest('#profile-form')) return;
  if (event.target.id === 'photo') return;
  if (event.target.name === 'avatar') {
    profile.photo = '';
    document.getElementById('photo').value = '';
    document.getElementById('photo-status').textContent = 'Your avatar is selected.';
  }
  if (event.target.id === 'everyone') document.querySelectorAll('[name=preferred_genders]').forEach(node => node.checked = event.target.checked);
  if (event.target.name === 'interests' && document.querySelectorAll('[name=interests]:checked').length > 3) {
    event.target.checked = false; toast('Pick your three favourites. You can always swap one.');
  }
  readForm();
  if (view === 'quiz' && event.target.name === 'answer') moveHeart(true);
  if (view === 'about') document.getElementById('identity-field').hidden = profile.gender !== 'another';
  if (view === 'preferences') {
    document.getElementById('everyone').checked = profile.preferred_genders.length === 4;
    document.getElementById('onboarding-progress').outerHTML = stepper();
  }
  if (view === 'personality') {
    document.getElementById('interest-count').textContent = `${profile.interests.length} of 3 selected · optional`;
    document.getElementById('prompt-count').textContent = `${profile.building_toward.length} / 240`;
    document.getElementById('building_toward').placeholder = promptHint(profile.prompt);
  }
  const previewNode = document.getElementById('live-profile');
  if (previewNode) previewNode.innerHTML = profileCard();
});
document.addEventListener('change', event => {
  if (event.target.id === 'photo') safely(() => choosePhoto(event.target.files[0]));
  if (event.target.id === 'music-track') safely(async () => { await music.choose(event.target.value); refreshSoundtrack(musicFocus()); });
  if (event.target.id === 'music-file') safely(async () => { await music.useFile(event.target.files[0]); refreshSoundtrack('music-track'); });
});
// Quiz shortcuts: A–D (or 1–4) pick an answer, Enter continues, M toggles music.
document.addEventListener('keydown', event => {
  if (view !== 'quiz' || event.ctrlKey || event.metaKey || event.altKey || event.target.matches('select, textarea, input:not([type=radio])') || event.target.closest('#profile-menu')) return;
  const key = event.key.toLowerCase();
  const index = key.length === 1 ? Math.max('abcd'.indexOf(key), '1234'.indexOf(key)) : -1;
  if (index >= 0) {
    const radio = document.querySelectorAll('[name=answer]')[index];
    if (!radio) return;
    event.preventDefault();
    radio.checked = true;
    radio.focus();
    radio.dispatchEvent(new Event('input', {bubbles:true}));
  } else if (key === 'enter' && event.target.name === 'answer') {
    event.preventDefault();
    document.getElementById('profile-form').requestSubmit();
  } else if (key === 'm') {
    safely(() => perform('music-toggle'));
  }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; renderHeader(); });
window.addEventListener('appinstalled', () => { installPrompt = null; renderHeader(); toast('HardLaunch is installed. Keep the Python server running to use it.'); });

async function start() {
  try {
    [config, session, savedProfiles] = await Promise.all([api('/api/config'), api('/api/session'), api('/api/profiles')]);
    if (new URLSearchParams(window.location.search).get('profiles') === '1') {
      profile = session?.profile;
      window.history.replaceState(null, '', '/');
      return go('profiles');
    }
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      demo = true;
      window.history.replaceState(null, '', '/');
      return await loadResults();
    }
    if (session) {
      profile = session.profile; questionIndex = session.question_index || 0;
      if (profile.status === 'complete') return await loadResults();
      return go(stages.includes(session.step) ? session.step : 'about', false);
    }
    go('welcome', false);
  } catch (error) {
    header.innerHTML = '<a class="brand" href="/"><img src="/assets/logo.svg" alt=""><span class="wordmark">Hard<span>Launch</span></span></a>';
    main.innerHTML = `<div class="profile-page"><h1>A little pause.</h1><p class="notice">${e(error.message)}</p><a class="btn" href="/">Try again</a></div>`;
  }
}
start();
