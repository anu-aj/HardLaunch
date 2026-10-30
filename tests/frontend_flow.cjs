/* Source-level interface integration checks, not a substitute for browser QA.
   A tiny DOM stand-in runs the real callbacks/templates against the real Python API. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = process.argv[2];
const nodes = new Map();
let formValues = {};
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {innerHTML:'', textContent:'', hidden:true, disabled:false,
    focus(){}, scrollIntoView(){}, setAttribute(){}, removeAttribute(){}, prepend(){}});
  return nodes.get(id);
}
const context = vm.createContext({
  console, URLSearchParams,
  setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); return timer; },
  clearTimeout,
  fetch: (url, options) => fetch(new URL(url, base), options),
  document: {getElementById:node, querySelectorAll:()=>[], addEventListener(){}, createElement:()=>node('error')},
  window: {scrollTo(){}, addEventListener(){}, location:{search:''}, history:{replaceState(){}}},
  navigator: {clipboard:{writeText:async text => { context.copied = text; }}},
  // Browser APIs are stand-ins here; real image decoding still needs browser QA.
  FileReader: class { readAsDataURL(file) { this.result = file.data; this.onload(); } },
  Image: class { set src(value) { this.onload(); } },
  FormData: class {
    get(key) { const value = formValues[key]; return Array.isArray(value) ? value[0] ?? null : value ?? null; }
    getAll(key) { const value = formValues[key]; return Array.isArray(value) ? value : value ? [value] : []; }
  },
});
const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const run = code => vm.runInContext(code, context);
const asyncRun = code => run(`(async () => { ${code} })()`);

(async () => {
  vm.runInContext(source.replace(/start\(\);\s*$/, 'globalThis.boot = start();'), context);
  await context.boot;
  assert.equal(run('view'), 'welcome');
  assert.match(node('main').innerHTML, /wavelength/);
  await asyncRun("await perform('demo', {});");
  assert.equal(run('results.matches.length'), 3);
  assert.equal(await (await fetch(new URL('/api/session', base))).json(), null);
  await asyncRun("await perform('edit-preferences', {});");
  assert.equal(run('view'), 'matches'); // Sample cannot be edited.
  await asyncRun("await perform('new', {});");
  assert.equal(run('view'), 'about');
  formValues = {name:'Casey <b>', age:'27', city:'Sydney', gender:'woman', pronouns:'they / them', identity_text:'', avatar:'flower'};
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'preferences');
  assert.match(node('main').innerHTML, /Casey &lt;b&gt;/);
  assert.match(node('main').innerHTML, /Choose carefully\.<\/strong> HardLaunch is for people looking for a genuine match/);
  assert.doesNotMatch(node('main').innerHTML, /Casey <b>/);
  formValues = {preferred_genders:['woman','man','non_binary','another'], age_min:'23', age_max:'36', intention:'Long-term relationship'};
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'personality');
  formValues = {interests:['Cooking','Books'], role:'Designer <b>', company:'Studio & Co', prompt:'sunday', building_toward:'Bookshops, pasta, and a very long walk.'};
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'quiz');
  const answers = [2,2,2,1,1,2,2,2,2,4,4,3,3,3,4];
  for (let i = 0; i < 15; i++) {
    assert.equal(run('questionIndex'), i);
    formValues = {answer:String(answers[i])};
    await asyncRun('await submitStep();');
    if (i === 2) {
      await asyncRun("await perform('resume', {});");
      assert.equal(run('questionIndex'), 3); // Refresh/resume restores saved progress.
      assert.equal(run('Object.keys(profile.answers).length'), 3);
    }
  }
  assert.equal(run('view'), 'review');
  assert.match(node('main').innerHTML, /Designer &lt;b&gt;/);
  assert.match(node('main').innerHTML, /Studio &amp; Co/);
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'wavelength');
  assert.match(node('main').innerHTML, /attachment style/);
  assert.match(node('main').innerHTML, /Nothing in your answers is wrong with you/);
  await asyncRun("await perform('show-matches', {});");
  assert.equal(run('view'), 'matches');
  assert.equal(run('results.matches.length'), 3);
  assert.match(node('main').innerHTML, /common ground|Worth exploring/);
  assert.doesNotMatch(node('main').innerHTML, /<small>\/100/);  // Cards show a label, not a number.
  await asyncRun("await perform('detail', {dataset:{id:results.matches[0].profile.id}});");
  assert.equal(run('view'), 'detail');
  assert.match(node('main').innerHTML, /Something to explore/);
  await asyncRun("await perform('copy', {});");
  assert.ok(context.copied.length > 10);
  await asyncRun("await perform('my-profile', {});");
  await asyncRun("await perform('edit', {dataset:{step:'about'}});");
  formValues = {name:'Casey', age:'27', city:'Darwin', gender:'woman', pronouns:'they / them', identity_text:'', avatar:'flower'};
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'review');
  await asyncRun('await submitStep();');
  assert.equal(run('results.matches.length'), 0);
  assert.match(node('main').innerHTML, /haven't widened/);
  await asyncRun("await perform('home', {});");
  await asyncRun("await perform('demo', {});");
  assert.equal(run('profile.name'), 'Maya');
  await asyncRun("await perform('home', {}); await perform('resume', {});");
  assert.equal(run('profile.name'), 'Casey');
  assert.equal(run('profile.city'), 'Darwin');
  assert.equal(run('profile.status'), 'complete');

  // Changing intention hides the quiz and ignores (but preserves) old answers.
  await asyncRun("await perform('edit-preferences', {});");
  assert.match(node('main').innerHTML, /can change only once a month/);
  formValues = {preferred_genders:['woman','man','non_binary','another'], age_min:'23', age_max:'36', intention:'Casual dating'};
  // A completed profile is cautioned on a confirmation page first.
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'confirm-type');
  assert.match(node('main').innerHTML, /Switch to Casual dating\?/);
  assert.match(node('main').innerHTML, /can change only once a month/);
  assert.match(node('main').innerHTML, /won’t be able to switch back to Long-term relationship/);
  await asyncRun("await perform('cancel-type-change', {});");
  assert.equal(run('view'), 'preferences');
  assert.equal(run('profile.intention'), 'Long-term relationship');
  assert.equal((await (await fetch(new URL('/api/session', base))).json()).profile.intention, 'Long-term relationship');
  await asyncRun("await submitStep(); await perform('confirm-type-change', {});");
  assert.equal(run('view'), 'matches');
  assert.equal(run('Object.keys(profile.answers).length'), 15);
  await asyncRun("await perform('my-profile', {});");
  assert.doesNotMatch(node('main').innerHTML, /data-step="quiz"/);
  // Switching straight back is refused for a month, and the saved type stays.
  await asyncRun("await perform('edit-preferences', {});");
  formValues.intention = 'Long-term relationship';
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'confirm-type');
  await assert.rejects(asyncRun("await perform('confirm-type-change', {});"), error => error.status === 409 && /once a month/.test(error.message));
  assert.equal(run('view'), 'preferences');
  assert.equal(run('profile.intention'), 'Casual dating');
  assert.equal((await (await fetch(new URL('/api/session', base))).json()).profile.intention, 'Casual dating');

  for (const intention of ['Exploring connections', 'Casual dating']) {
    // Two local people ensure both intentions have an actual match to inspect.
    for (let person = 0; person < 2; person++) {
      await asyncRun("await perform('new', {});");
      formValues = {name:`New person ${person}`, age:'27', city:'Sydney', gender:'woman', pronouns:'', identity_text:'', avatar:'sun'};
      await asyncRun('await submitStep();');
      formValues = {preferred_genders:['woman','man','non_binary','another'], age_min:'23', age_max:'36', intention};
      await asyncRun('await submitStep();');
      assert.equal(run('view'), 'personality');
      assert.equal(run('activeStages().length'), 4);
      formValues = {interests:['Cooking','Books'], prompt:'sunday', building_toward:'A good book and a good coffee.'};
      await asyncRun('await submitStep();');
      assert.equal(run('view'), 'review');
      assert.doesNotMatch(node('main').innerHTML, /data-step="quiz"|15 questions/);
      await asyncRun("await perform('back', {});");
      assert.equal(run('view'), 'personality');
      await asyncRun('await submitStep();');
      await asyncRun("await perform('resume', {});");
      assert.equal(run('view'), 'review');
      await asyncRun('await submitStep();');
      assert.equal(run('view'), 'matches');
      assert.equal(run('Object.keys(profile.answers).length'), 0);
      if (person === 1) {
        assert.ok(run('results.matches.length') > 0);
        assert.ok(run('results.matches.every(match => match.score === null)'));
        assert.doesNotMatch(node('main').innerHTML, /<strong>Answer alignment|<small>\/100/);
        await asyncRun("await perform('detail', {dataset:{id:results.matches[0].profile.id}});");
        assert.doesNotMatch(node('main').innerHTML, /class="score-number"|<strong>You<\/strong>/);
        await asyncRun("await perform('my-profile', {});");
        assert.doesNotMatch(node('main').innerHTML, /data-step="quiz"/);
      }
    }
  }
  // A completed profile switching to long-term must do the quiz before matching.
  // Its current matches are refreshed automatically, and the person is told.
  await asyncRun("await perform('edit-preferences', {});");
  assert.match(node('main').innerHTML, /refreshes your matches automatically/);
  formValues = {preferred_genders:['woman','man','non_binary','another'], age_min:'23', age_max:'36', intention:'Long-term relationship'};
  await asyncRun('await submitStep();');
  assert.match(node('main').innerHTML, /Your 1 current match will end/);
  await asyncRun("await perform('confirm-type-change', {});");
  assert.equal(run('session.matches_refreshed'), 1);
  assert.match(node('toast').textContent, /matches are being refreshed automatically/);
  assert.equal(run('view'), 'quiz');
  assert.equal(run('questionIndex'), 0);
  assert.equal(run('profile.status'), 'draft');
  await asyncRun("await perform('resume', {});");
  assert.equal(run('view'), 'quiz');
  for (const answer of answers) {
    formValues = {answer:String(answer)};
    await asyncRun('await submitStep();');
  }
  assert.equal(run('view'), 'review');
  await asyncRun('await submitStep();');
  assert.equal(run('view'), 'wavelength');
  await asyncRun("await perform('show-matches', {});");
  assert.equal(run('view'), 'matches');
  assert.ok(run('results.matches.every(match => Number.isInteger(match.score))'));
  // A second completed local long-term profile is automatically paired on both sides.
  await asyncRun(`
    globalThis.firstLongTerm = {...profile, answers:{...profile.answers}};
    await perform('new', {});
    profile = {...firstLongTerm, id:profile.id, name:'Long-term partner'};
    await submitProfile();
  `);
  assert.ok(run('results.matches.some(m => m.auto_matched && m.profile.id === firstLongTerm.id)'));
  assert.match(node('main').innerHTML, /Would you like to meet\?/);
  await asyncRun("await perform('detail', {dataset:{id:firstLongTerm.id}});");
  assert.match(node('main').innerHTML, /You’re matched on your wavelength/);
  assert.doesNotMatch(node('main').innerHTML, /Start conversation/);
  await asyncRun("await perform('meet', {dataset:{id:firstLongTerm.id}});");
  assert.equal(run('view'), 'detail');
  assert.match(node('main').innerHTML, /Their choice stays private/);
  // Waiting is not a dead end on one laptop: switch straight to the other person's side of the match.
  assert.match(node('main').innerHTML, /data-action="meet-switch"/);
  await asyncRun(`
    globalThis.secondLongTermId = profile.id;
    await perform('meet-switch', {dataset:{id:firstLongTerm.id}});
  `);
  assert.equal(run('profile.id'), run('firstLongTerm.id'));
  assert.equal(run('view'), 'detail');
  assert.equal(run('detailId'), run('secondLongTermId'));
  assert.ok(run('results.matches.some(m => m.auto_matched && m.profile.id === secondLongTermId)'));
  // Exercise both sides of the real persisted conversation, without fake replies.
  await asyncRun("await perform('profiles', {});");
  assert.equal(run('view'), 'profiles');
  assert.match(node('main').innerHTML, /Create a new profile/);
  await asyncRun("await perform('demo-pair', {});");
  assert.equal(run('profile.name'), 'Avery');
  assert.equal(run('profile.intention'), 'Casual dating');
  // The prepared pair arrives having both said "I'd like to meet", so the walkthrough can chat straight away.
  assert.ok(run("results.matches.some(m => m.profile.id === 'demo-jordan' && m.auto_matched && m.meet_status === 'mutual' && m.can_chat)"));
  await asyncRun("await perform('detail', {dataset:{id:'demo-jordan'}});");
  assert.match(node('main').innerHTML, /Software developer/);
  assert.match(node('main').innerHTML, /Start conversation/);
  await asyncRun("await perform('start-chat', {dataset:{id:'demo-jordan'}});");
  assert.equal(run('view'), 'chat');
  node('message-text').value = 'Hello <script>bad</script> Jordan!';
  await asyncRun("await perform('refresh-chat', {});");
  assert.equal(node('message-text').value, 'Hello <script>bad</script> Jordan!');
  await asyncRun('await sendMessage();');
  assert.match(node('main').innerHTML, /Hello &lt;script&gt;bad&lt;\/script&gt; Jordan!/);
  assert.doesNotMatch(node('main').innerHTML, /<script>/);
  assert.equal(run('conversation.messages.length'), 1);
  await asyncRun("await perform('chat-switch', {dataset:{id:'demo-jordan'}});");
  assert.equal(run('profile.name'), 'Jordan');
  assert.equal(run('conversation.messages[0].sender_id'), 'demo-avery');
  node('message-text').value = 'Hi Avery! Coffee?';
  await asyncRun('await sendMessage();');
  await asyncRun("await perform('chat-switch', {dataset:{id:'demo-avery'}});");
  assert.equal(run('conversation.messages.length'), 2);
  assert.equal(run('conversation.messages[1].sender_id'), 'demo-jordan');
  await asyncRun("await perform('messages', {});");
  assert.equal(run('conversations.length'), 1);
  assert.match(node('main').innerHTML, /Hi Avery! Coffee/);
  await asyncRun("await perform('open-chat', {dataset:{id:conversations[0].id}});");
  assert.equal(run('conversation.messages.length'), 2);
  // Picture renders throughout the card templates, with an avatar fallback.
  run("profile.photo = 'data:image/png;base64,iVBORw0KGgo=';");
  assert.match(run('profileCard()'), /class="profile-photo"/);
  run("profile.photo = '';");
  assert.doesNotMatch(run('profileCard()'), /class="profile-photo"/);
  // Upload is directly accessible while editing an existing completed profile.
  await asyncRun("await perform('my-profile', {});");
  assert.match(node('main').innerHTML, /id="photo-form"/);
  assert.match(node('main').innerHTML, /type="file" id="photo"/);
  assert.match(node('main').innerHTML, /Save picture/);
  const png = fs.readFileSync(path.join(__dirname, '../web/assets/icon-192.png'));
  context.photoFile = {type:'image/png', size:png.length, data:'data:image/png;base64,'+png.toString('base64')};
  await asyncRun('await choosePhoto(photoFile); await savePicture();');
  assert.equal(run('view'), 'my-profile');
  assert.equal(run('profile.status'), 'complete');
  assert.equal((await (await fetch(new URL('/api/session', base))).json()).profile.photo, context.photoFile.data);
  run("profile.photo = ''; profile.avatar = 'spark';");
  await asyncRun("await perform('cancel-photo', {});");
  assert.equal(run('profile.photo'), context.photoFile.data);
  run("profile.photo = ''; profile.avatar = 'spark';");
  await asyncRun('await savePicture();');
  assert.equal((await (await fetch(new URL('/api/session', base))).json()).profile.avatar, 'spark');

  // Confirmation and cancellation are separate from the destructive request.
  await asyncRun("await perform('delete-profile', {dataset:{id:profile.id}});");
  assert.equal(run('view'), 'delete-profile');
  assert.match(node('main').innerHTML, /Delete Avery/);
  assert.match(node('main').innerHTML, /both people’s messages/);
  assert.equal((await (await fetch(new URL('/api/session', base))).json()).profile.id, 'demo-avery');
  await asyncRun("await perform('cancel-delete', {});");
  assert.equal(run('view'), 'my-profile');
  await asyncRun("await perform('delete-profile', {dataset:{id:profile.id}}); await perform('confirm-delete', {});");
  assert.equal(run('view'), 'profiles');
  assert.equal(run('profile'), undefined);
  assert.ok(run("savedProfiles.every(person => person.id !== 'demo-avery')"));
  await asyncRun("await perform('switch-profile', {dataset:{id:'demo-jordan'}}); await perform('messages', {});");
  assert.equal(run('conversations.length'), 0);
  await asyncRun("await perform('demo', {}); await perform('my-profile', {});");
  assert.doesNotMatch(node('main').innerHTML, /id="photo-form"|data-action="delete-profile"/);
  await asyncRun("await perform('matches', {}); await perform('detail', {dataset:{id:results.matches[0].profile.id}});");
  assert.doesNotMatch(node('main').innerHTML, /data-action="unmatch"/);

  // A hub with six mutually eligible people makes every replacement observable.
  await asyncRun(`
    globalThis.unmatchTestIds = [];
    const template = {...profile, city:'Darwin', intention:'Casual dating', answers:{}, age:27, age_min:18, age_max:99};
    for (let index = 0; index < 7; index++) {
      const fresh = await api('/api/new', {});
      const person = {...template, id:fresh.profile.id, name:index === 0 ? 'Unmatch tester' : 'Candidate '+index,
        gender:index === 0 ? 'man' : 'woman', preferred_genders:[index === 0 ? 'woman' : 'man']};
      await api('/api/complete', {profile:person});
      unmatchTestIds.push(person.id);
    }
    await perform('switch-profile', {dataset:{id:unmatchTestIds[0]}});
    globalThis.originalMatchIds = results.matches.filter(match => match.auto_matched).map(match => match.profile.id);
    globalThis.firstUnmatchId = originalMatchIds[0];
  `);
  assert.equal(run('results.matches.length'), 3);
  assert.equal(run('originalMatchIds.length'), 3);
  assert.match(node('main').innerHTML, /3 of 3 active matches/);
  assert.match(node('main').innerHTML, /2 of 2 unmatches available/);
  assert.match(node('main').innerHTML, /Rolling 7-hour limit/);
  assert.match(node('main').innerHTML, /Everyone gets 2 unmatches every 7 hours/);
  assert.doesNotMatch(node('main').innerHTML, /Premium|data-action="(?:upgrade|activate-premium|checkout)"/);
  await asyncRun("await perform('detail', {dataset:{id:firstUnmatchId}}); await perform('unmatch', {dataset:{id:firstUnmatchId}});");
  assert.equal(run('view'), 'unmatch');
  assert.match(node('main').innerHTML, /ends the match for both of you/);
  assert.match(node('main').innerHTML, /read-only/);
  assert.match(node('main').innerHTML, /If no one is available, your place stays open/);
  await asyncRun("await perform('cancel-unmatch', {}); await perform('matches', {});");
  assert.equal(run('results.unmatch_policy.remaining'), 2);
  assert.ok(run('results.matches.some(match => match.profile.id === firstUnmatchId)'));

  await asyncRun(`
    await perform('meet', {dataset:{id:firstUnmatchId}});
    await perform('switch-profile', {dataset:{id:firstUnmatchId}});
    await perform('detail', {dataset:{id:unmatchTestIds[0]}});
    await perform('meet', {dataset:{id:unmatchTestIds[0]}});
    await perform('switch-profile', {dataset:{id:unmatchTestIds[0]}});
    await perform('start-chat', {dataset:{id:firstUnmatchId}});
  `);
  node('message-text').value = 'A hello to preserve after unmatching.';
  await asyncRun('await sendMessage(); globalThis.unmatchedChatId = conversation.id;');
  assert.match(node('main').innerHTML, /data-action="unmatch"/);
  node('message-text').value = 'An unsent thought';
  await asyncRun("await perform('unmatch', {dataset:{id:firstUnmatchId}}); await perform('cancel-unmatch', {});");
  assert.equal(run('view'), 'chat');
  assert.equal(node('message-text').value, 'An unsent thought');
  await asyncRun("await perform('unmatch', {dataset:{id:firstUnmatchId}}); await perform('confirm-unmatch', {});");
  assert.equal(run('view'), 'matches');
  assert.equal(run('results.unmatch_policy.remaining'), 1);
  assert.equal(run('results.matches.filter(match => match.auto_matched).length'), 3);
  assert.ok(run('results.matches.every(match => match.profile.id !== firstUnmatchId)'));
  assert.ok(run('results.matches.some(match => !originalMatchIds.includes(match.profile.id))'));
  assert.ok(run('originalMatchIds.slice(1).every(id => results.matches.some(match => match.profile.id === id))'));
  await asyncRun("await perform('messages', {});");
  assert.match(node('main').innerHTML, /Unmatched · Read-only/);
  await asyncRun("await perform('open-chat', {dataset:{id:unmatchedChatId}});");
  assert.match(node('main').innerHTML, /A hello to preserve after unmatching/);
  assert.match(node('main').innerHTML, /Unmatched · Read-only conversation/);
  assert.doesNotMatch(node('main').innerHTML, /id="message-form"|data-action="unmatch"/);
  await asyncRun("await perform('chat-switch', {dataset:{id:firstUnmatchId}});");
  assert.equal(run('conversation.can_send'), false);
  assert.equal(run('conversation.unmatched'), true);
  await asyncRun("await perform('matches', {});");
  assert.equal(run('results.unmatch_policy.remaining'), 2); // Only the person choosing unmatch spends an allowance.
  assert.ok(run('results.matches.every(match => match.profile.id !== unmatchTestIds[0])'));

  await asyncRun(`
    await perform('switch-profile', {dataset:{id:unmatchTestIds[0]}});
    await perform('detail', {dataset:{id:results.matches[0].profile.id}});
    await perform('unmatch', {dataset:{id:detailId}});
    const separateMatch = results.matches.find(match => match.profile.id !== pendingUnmatch.id);
    await api('/api/unmatch', {profile_id:profile.id, other_id:separateMatch.profile.id, reason:'did_not_vibe', confirm:true});
  `);
  // Another tab used the last allowance after this confirmation was opened.
  await assert.rejects(asyncRun("await perform('confirm-unmatch', {});"), error => error.status === 429);
  assert.equal(run('view'), 'unmatch');
  assert.equal(run('unmatchPolicy().remaining'), 0);
  assert.match(node('main').innerHTML, /0 of 2 unmatches available/);
  assert.match(node('main').innerHTML, /You can unmatch again from/);
  assert.match(node('main').innerHTML, /data-action="confirm-unmatch" disabled/);
  await asyncRun("await perform('refresh-unmatch-status', {}); await perform('confirm-unmatch', {});");
  assert.equal(run('unmatchPolicy().used'), 2);
  assert.equal(run('view'), 'unmatch');
  await asyncRun("await perform('cancel-unmatch', {}); await perform('matches', {});");
  assert.equal(run('results.matches.filter(match => match.auto_matched).length'), 3);
  assert.equal(run('results.unmatch_policy.remaining'), 0);

  // Blocking stays available with no unmatches left, and never uses the allowance.
  await asyncRun(`
    globalThis.blockedId = results.matches[0].profile.id;
    await perform('detail', {dataset:{id:blockedId}});
    await perform('block', {dataset:{id:blockedId}});
  `);
  assert.equal(run('view'), 'block');
  assert.match(node('main').innerHTML, /Blocking is always free/);
  await asyncRun("await perform('cancel-block', {});");
  assert.equal(run('view'), 'detail');
  await asyncRun("await perform('block', {dataset:{id:blockedId}}); await perform('confirm-block', {});");
  assert.equal(run('view'), 'matches');
  assert.ok(run('results.matches.every(match => match.profile.id !== blockedId)'));
  assert.equal(run('results.unmatch_policy.remaining'), 0);

  // Log out clears only the active profile; one click logs back in (no passwords in this proof of concept).
  await asyncRun(`globalThis.loggedOutId = profile.id; await perform('logout', {});`);
  assert.equal(run('view'), 'profiles');
  assert.equal(run('profile'), null);
  assert.equal(await (await fetch(new URL('/api/session', base))).json(), null);
  assert.match(node('main').innerHTML, /Who’s using HardLaunch\?/);
  assert.match(node('main').innerHTML, /Log in as /);
  assert.match(node('header').innerHTML, /data-action="profiles">Log in</);
  await asyncRun("await perform('switch-profile', {dataset:{id:loggedOutId}});");
  assert.equal(run('profile.id'), run('loggedOutId'));
  assert.equal(run('view'), 'matches');
  assert.match(node('header').innerHTML, /data-action="logout"/);

  // Spotify links: share links, regional links and spotify: URIs work; anything else is refused.
  const id = '4cOdK2wGLETKBW3PvgPWqT';
  for (const link of [`https://open.spotify.com/track/${id}?si=abc123`, `https://open.spotify.com/intl-en/track/${id}`, `spotify:track:${id}`, `  https://open.spotify.com/embed/track/${id}  `])
    assert.equal(run(`spotifyUri(${JSON.stringify(link)})`), `spotify:track:${id}`);
  assert.equal(run(`spotifyUri('https://open.spotify.com/playlist/${id}')`), `spotify:playlist:${id}`);
  for (const link of [`https://evil.example/open.spotify.com/track/${id}`, `https://open.spotify.com.evil.example/track/${id}`, 'javascript:alert(1)', `https://open.spotify.com/track/${id}x`, ''])
    assert.equal(run(`spotifyUri(${JSON.stringify(link)})`), '');

  // The global busy wrapper preserves intentional disabled state, including newly rendered controls.
  const disabledControl = {disabled:true}, enabledControl = {disabled:false}, newControl = {disabled:true};
  context.document.querySelectorAll = () => [disabledControl, enabledControl];
  context.replaceControls = () => { context.document.querySelectorAll = () => [newControl]; };
  await asyncRun('await safely(async () => { replaceControls(); });');
  assert.equal(disabledControl.disabled, true);
  assert.equal(enabledControl.disabled, false);
  assert.equal(newControl.disabled, true);
  console.log('PASS: profile journeys, matching, conversations, photos, deletion, unmatch confirmation/cancellation, replacement, read-only history, rolling limit, meet consent, blocking, wavelength summary and intention refresh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
