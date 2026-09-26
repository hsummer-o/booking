const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbydwistl8tzrBEPDonM7-WEArqIZVzg2l-3d7Am1svT2v6mmE62N5WvcH08jithXjuV/exec',
  AVAILABLE_HOURS: [9, 10, 11, 13, 14, 15],
  DURATION_MINUTES: 60,
  MAX_DAYS_AHEAD: 120,
  // 期限切れのキャンペーンコードは撮影日が過去日のため以後マッチしない。
  // 新しいキャンペーンを開始する際はここに追加する。
  COUPONS: {
  },
};

const DAYS_JP = ['日','月','火','水','木','金','土'];
const MONTHS_JP = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

let busyMap = {};
let calLoaded = false;

let state = {
  type: null,
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: null,
  selectedTime: null,
  secondTime: null,
  isConsult: false,
  couponCode:    null,
  couponApplied: false,
  appliedPrice:  null,
};

// ---- Step navigation ----
function goStep(n) {
  [1,2,3,4,5].forEach(i => {
    document.getElementById(`panel-${i}`).classList.toggle('active', i===n);
  });
  [1,2,3,4].forEach(i => {
    const d = document.getElementById(`dot-${i}`);
    if (d) {
      d.classList.toggle('active', i===n);
      d.classList.toggle('done', i<n);
    }
  });
  if (n===2) {
    if (!calLoaded) initCalendarStep();
    else if (CONFIG.GAS_URL !== 'YOUR_GAS_DEPLOY_URL') loadCalendarFromGAS(true); // 再訪時は最新の空き状況へ更新
    startCalAutoRefresh();
  } else {
    stopCalAutoRefresh();
  }
  if (n===3) togglePreferredTimeField();
  if (n===4) fillSummary();
  window.scrollTo(0,0);
}

// ---- Step 1 ----
function selectType(type, el) {
  state.type = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('btn-1').disabled = false;
  setTimeout(() => goStep(2), 400);
}

// ---- Calendar Step ----
function initCalendarStep() {
  if (CONFIG.GAS_URL === 'YOUR_GAS_DEPLOY_URL') {
    loadDemoData();
    return;
  }
  loadCalendarFromGAS();
}

function showStatus(type, msg) {
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (type==='ok'?'ok':type==='error'?'error':'');
  document.getElementById('status-msg').textContent = msg;
}

// ---- GASから空き状況を取得 ----
async function loadCalendarFromGAS(silent) {
  if (!silent) showStatus('', '空き状況を確認中...');
  try {
    // GASはGETリクエストでも空き状況を返す（CORSリダイレクト対応）
    // キャッシュバスター付与 + no-store で、ブラウザ/GAS側のキャッシュによる
    // 古い空き状況の表示を防ぐ
    const url = CONFIG.GAS_URL + '?action=getAvailability&_=' + Date.now();
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    busyMap = data.busyMap || {};
    calLoaded = true;
    showStatus('ok', '空き状況を読み込みました');
    renderCalendar();
    refreshTimeSlots();
  } catch(e) {
    if (!silent) {
      showStatus('error', '読み込みに失敗しました。しばらくしてから再度お試しください。');
      loadDemoData();
    }
  }
}

// ---- 表示中は定期的にバックグラウンドで空き状況を更新 ----
let calRefreshTimer = null;
function startCalAutoRefresh() {
  stopCalAutoRefresh();
  if (CONFIG.GAS_URL === 'YOUR_GAS_DEPLOY_URL') return;
  calRefreshTimer = setInterval(() => loadCalendarFromGAS(true), 60000);
}
function stopCalAutoRefresh() {
  if (calRefreshTimer) { clearInterval(calRefreshTimer); calRefreshTimer = null; }
}

// ---- Demo mode ----
function loadDemoData() {
  busyMap = {};
  const today = new Date();
  [2,5,9,13,17].forEach(offset => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const key = toDateKey(d);
    busyMap[key] = offset % 2 === 0 ? [9,10] : 'allday';
  });
  calLoaded = true;
  showStatus('ok', '空き状況を表示しています');
  renderCalendar();
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- 今日の日付で、かつ枠の開始時刻が現在時刻を過ぎているか ----
function isHourPast(dateKey, h) {
  const now = new Date();
  if (dateKey !== toDateKey(now)) return false;
  const slotStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0);
  return slotStart <= now;
}

// ---- Render calendar ----
function renderCalendar() {
  const { year, month } = state;
  document.getElementById('cal-month').textContent = `${year}年 ${MONTHS_JP[month]}`;

  const dayNames = document.getElementById('cal-day-names');
  dayNames.innerHTML = DAYS_JP.map(d => `<div class="day-name">${d}</div>`).join('');

  const grid = document.getElementById('cal-grid');
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date();
  const todayKey = toDateKey(today);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + CONFIG.MAX_DAYS_AHEAD);

  let html = '';
  for (let i=0; i<firstDay; i++) html += '<div class="day-cell empty"></div>';

  for (let d=1; d<=daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const key = toDateKey(cellDate);
    const allHoursPastToday = key === todayKey &&
      CONFIG.AVAILABLE_HOURS.every(h => isHourPast(key, h));
    const isPast = cellDate < new Date(today.getFullYear(), today.getMonth(), today.getDate()) ||
      allHoursPastToday;
    const isTooFar = cellDate > maxDate;
    const isSelected = key === state.selectedDate;
    const busy = busyMap[key];

    let cls = 'day-cell';
    let dot = '';

    if (isPast || isTooFar) {
      cls += ' past';
    } else if (busy === 'allday') {
      cls += ' busy-full';
      dot = '<div class="avail-dot red"></div>';
    } else if (busy && busy.length >= CONFIG.AVAILABLE_HOURS.length) {
      cls += ' busy-full';
      dot = '<div class="avail-dot red"></div>';
    } else if (busy && busy.length > 0) {
      cls += ' partial available';
      dot = '<div class="avail-dot green"></div>';
    } else {
      cls += ' available';
      dot = '<div class="avail-dot green"></div>';
    }

    if (isSelected) cls += ' selected';
    if (key === todayKey) cls += ' today';

    const clickable = !isPast && !isTooFar && busy !== 'allday' &&
                      !(busy && busy.length >= CONFIG.AVAILABLE_HOURS.length);
    html += `<div class="${cls}" ${clickable?`onclick="selectDate('${key}',${cellDate.getDay()})"`:''}>${d}${dot}</div>`;
  }

  grid.innerHTML = html;
}

function selectDate(key, dow) {
  state.selectedDate = key;
  state.selectedTime = null;
  document.getElementById('btn-2').disabled = true;
  state.secondTime = null;
  const consultBtn = document.getElementById('time-consult-btn');
  if (consultBtn) consultBtn.classList.remove('consult-selected');
  document.getElementById('add-second-slot-wrap').style.display = 'none';
  document.getElementById('second-slot-area').style.display = 'none';
  renderCalendar();

  const parts = key.split('-');
  document.getElementById('time-label').textContent =
    `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日（${DAYS_JP[dow]}）の時間帯`;

  const busyHours = busyMap[key] || [];
  const html = CONFIG.AVAILABLE_HOURS.map(h => {
    const isBusy = busyHours !== 'allday' && busyHours.includes && busyHours.includes(h);
    const isPast = isHourPast(key, h);
    const label = `${h}:00`;
    return `<button class="time-btn" ${(isBusy||isPast)?'disabled':''} onclick="selectTime('${label}',this)">${label}</button>`;
  }).join('');

  document.getElementById('time-grid').innerHTML = html;
  document.getElementById('time-section').style.display = 'block';
}

// ---- 選択中の日付があれば、最新のbusyMapで時間帯ボタンを再描画 ----
// （他の予約が入って選択済みの時間が埋まった場合は選択を解除する）
function refreshTimeSlots() {
  if (!state.selectedDate) return;
  const key = state.selectedDate;
  const busyHours = busyMap[key] || [];

  if (busyHours === 'allday') {
    // 丸ごと埋まった場合は選択解除してカレンダーへ戻す
    state.selectedDate = null;
    state.selectedTime = null;
    document.getElementById('btn-2').disabled = true;
    document.getElementById('time-section').style.display = 'none';
    return;
  }

  const html = CONFIG.AVAILABLE_HOURS.map(h => {
    const isBusy = busyHours.includes && busyHours.includes(h);
    const isPast = isHourPast(key, h);
    const label = `${h}:00`;
    const isSelected = state.selectedTime === label && !isBusy && !isPast;
    if ((isBusy || isPast) && state.selectedTime === label) {
      // 選択済みの時間が他の予約で埋まった、または時間が過ぎた場合は選択を解除
      state.selectedTime = null;
      document.getElementById('btn-2').disabled = true;
    }
    return `<button class="time-btn ${isSelected?'selected':''}" ${(isBusy||isPast)?'disabled':''} onclick="selectTime('${label}',this)">${label}</button>`;
  }).join('');

  document.getElementById('time-grid').innerHTML = html;
}

function selectTime(time, el) {
  state.selectedTime = time;
  state.isConsult = false;
  state.secondTime = null;
  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const consultBtn = document.getElementById('time-consult-btn');
  if (consultBtn) consultBtn.classList.remove('consult-selected');
  document.getElementById('btn-2').disabled = false;
  // 2枠目エリアをリセット
  document.getElementById('add-second-slot-wrap').style.display = 'block';
  document.getElementById('second-slot-area').style.display = 'none';
  renderSecondSlot();
}

function selectConsultTime(el) {
  state.selectedTime = 'ご相談希望';
  state.isConsult = true;
  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('consult-selected');
  document.getElementById('btn-2').disabled = false;
}

function showSecondSlot() {
  document.getElementById('second-slot-area').style.display = 'block';
  document.getElementById('add-second-slot-wrap').style.display = 'none';
  renderSecondSlot();
}

function removeSecondSlot() {
  state.secondTime = null;
  document.getElementById('second-slot-area').style.display = 'none';
  document.getElementById('add-second-slot-wrap').style.display = 'block';
}

function renderSecondSlot() {
  if (!state.selectedTime || state.isConsult) return;
  const firstHour = parseInt(state.selectedTime.split(':')[0]);
  const busyHours = busyMap[state.selectedDate] || [];

  // 1枠目の終了時間以降の時間帯のみ選択可能
  const html = CONFIG.AVAILABLE_HOURS.map(h => {
    if (h <= firstHour) return ''; // 1枠目以前は非表示
    const isBusy = Array.isArray(busyHours) && busyHours.includes(h);
    const isSelected = state.secondTime === `${h}:00`;
    const label = `${h}:00`;
    return `<button class="time-btn${isSelected ? ' selected' : ''}" ${isBusy ? 'disabled' : ''} onclick="selectSecondTime('${label}', this)">${label}</button>`;
  }).join('');

  const grid = document.getElementById('time-grid-2');
  grid.innerHTML = html || '<p style="font-size:12px;color:var(--fg3);grid-column:1/-1;">この時間帯の後に空き枠がありません</p>';
}

function selectSecondTime(time, el) {
  state.secondTime = time;
  document.querySelectorAll('#time-grid-2 .time-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  // 合計金額を表示
  document.getElementById('second-slot-price').textContent =
    `1枠目 ${state.selectedTime} + 2枠目 ${time} → 合計 ¥60,000（税込）`;
}

function changeMonth(dir) {
  state.month += dir;
  if (state.month > 11) { state.month=0; state.year++; }
  if (state.month < 0) { state.month=11; state.year--; }
  state.selectedDate = null;
  state.selectedTime = null;
  document.getElementById('time-section').style.display = 'none';
  document.getElementById('btn-2').disabled = true;
  renderCalendar();
}

// ---- Step 3 ----
function formatTel(input) {
  // 数字以外を除去
  let v = input.value.replace(/[^\d]/g, '');
  // ハイフン自動挿入
  if (v.length <= 3) {
    input.value = v;
  } else if (v.length <= 7) {
    input.value = v.slice(0,3) + '-' + v.slice(3);
  } else {
    input.value = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
  }
}

function getLocation() {
  return document.getElementById('f-location').value.trim() || '未定';
}

function togglePreferredTimeField() {
  const group = document.getElementById('f-preferred-time-group');
  const input = document.getElementById('f-preferred-time');
  if (state.isConsult) {
    group.style.display = 'block';
  } else {
    group.style.display = 'none';
    input.value = '';
  }
  checkForm();
}

function checkForm() {
  const requiredIds = ['f-name','f-kana','f-email','f-tel','f-age','f-count'];
  // ご相談希望の場合は希望時間も必須
  if (state.isConsult) requiredIds.push('f-preferred-time');
  const ok = requiredIds.every(id => document.getElementById(id).value.trim());
  document.getElementById('btn-3').disabled = !ok;
  if (ok) document.getElementById('form-error').style.display = 'none';
}

function tryGoStep4() {
  const fields = [
    { id: 'f-name', label: 'お名前' },
    { id: 'f-kana', label: 'フリガナ' },
    { id: 'f-email', label: 'メールアドレス' },
    { id: 'f-tel', label: '電話番号' },
    { id: 'f-age', label: 'お子様の年齢・月齢' },
    { id: 'f-count', label: 'お子様の人数' },
  ];
  if (state.isConsult) fields.push({ id: 'f-preferred-time', label: 'ご希望の時間帯' });
  const empty = fields.filter(f => !document.getElementById(f.id).value.trim());
  if (empty.length > 0) {
    // 未入力フィールドをハイライト
    fields.forEach(f => {
      const el = document.getElementById(f.id);
      el.style.borderColor = el.value.trim() ? '' : 'var(--red)';
    });
    document.getElementById('form-error').style.display = 'block';
    // 最初の未入力欄にスクロール
    document.getElementById(empty[0].id).focus();
    return;
  }
  // すべて入力済み → 次へ
  document.getElementById('form-error').style.display = 'none';
  fields.forEach(f => document.getElementById(f.id).style.borderColor = '');
  goStep(4);
}

// ---- Step 4: Summary ----
function fillSummary() {
  const parts = state.selectedDate.split('-');
  document.getElementById('s-type').textContent = state.type;
  document.getElementById('s-date').textContent =
    `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  const preferredTime = document.getElementById('f-preferred-time').value;
  document.getElementById('s-time').textContent = state.isConsult && preferredTime
    ? `ご相談希望（${preferredTime}）`
    : state.selectedTime;
  document.getElementById('s-name').textContent =
    `${document.getElementById('f-name').value}（${document.getElementById('f-kana').value}）`;
  document.getElementById('s-email').textContent = document.getElementById('f-email').value;
  document.getElementById('s-tel').textContent = document.getElementById('f-tel').value;
  document.getElementById('s-child').textContent =
    `${document.getElementById('f-age').value} / ${document.getElementById('f-count').value}名`;
  document.getElementById('s-location').textContent = getLocation();
  const nickname = document.getElementById('f-nickname').value;
  document.getElementById('s-nickname-row').style.display = nickname ? 'flex' : 'none';
  document.getElementById('s-nickname').textContent = nickname;
  const note = document.getElementById('f-note').value;
  document.getElementById('s-note-row').style.display = note ? 'flex' : 'none';
  document.getElementById('s-note').textContent = note;

  // 2枠目
  const s2row = document.getElementById('s-second-time-row');
  const s2price = document.getElementById('s-price-row');
  if (state.secondTime) {
    document.getElementById('s-second-time').textContent = state.secondTime;
    if (s2row) s2row.style.display = 'flex';
    if (s2price) s2price.style.display = 'flex';
  } else {
    if (s2row) s2row.style.display = 'none';
    if (s2price) s2price.style.display = 'flex';
  }

  // 料金（クーポン対応）
  const normalPrice = 30000;
  const slots       = state.secondTime ? 2 : 1;

  // クーポン行の表示制御
  const couponRow = document.getElementById('s-coupon-row');
  if (couponRow) {
    couponRow.style.display = state.couponApplied ? 'flex' : 'none';
    document.getElementById('s-coupon').textContent = state.couponCode;
  }

  if (state.couponApplied && state.appliedPrice != null) {
    const discountPerSlot = normalPrice - state.appliedPrice;
    const totalDiscount   = discountPerSlot * slots;
    const totalNormal     = normalPrice * slots;
    const totalFinal      = state.appliedPrice * slots;
    const couponDef       = CONFIG.COUPONS[state.couponCode] || {};

    // 通常価格行
    document.getElementById('s-regular-price-row').style.display = 'flex';
    document.getElementById('s-regular-price').textContent = `¥${totalNormal.toLocaleString()}（税込）`;

    // 割引行
    document.getElementById('s-discount-row').style.display = 'flex';
    document.getElementById('s-discount-label').textContent = `割引（${couponDef.label || 'キャンペーン'}）`;
    document.getElementById('s-discount').textContent = `-¥${totalDiscount.toLocaleString()}`;

    // キャンペーン後価格
    document.getElementById('s-price-label').textContent = 'キャンペーン価格';
    document.getElementById('s-price').textContent = `¥${totalFinal.toLocaleString()}（税込）`;
  } else {
    const total = normalPrice * slots;

    document.getElementById('s-regular-price-row').style.display = 'none';
    document.getElementById('s-discount-row').style.display = 'none';
    document.getElementById('s-price-label').textContent = '撮影料金';
    document.getElementById('s-price').textContent = `¥${total.toLocaleString()}（税込）`;
  }
}

// ---- Submit: GAS経由でカレンダー登録＋メール送信 ----
async function submitBooking() {
  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = '送信中...';
  document.getElementById('submit-error').style.display = 'none';

  const payload = {
    action: 'createBooking',
    type: state.type,
    date: state.selectedDate,
    time: state.selectedTime,
    preferredTime: state.isConsult ? document.getElementById('f-preferred-time').value : '',
    secondTime: state.secondTime || '',
    name: document.getElementById('f-name').value,
    kana: document.getElementById('f-kana').value,
    nickname: document.getElementById('f-nickname').value,
    email: document.getElementById('f-email').value,
    tel: document.getElementById('f-tel').value,
    age: document.getElementById('f-age').value,
    count: document.getElementById('f-count').value,
    location: getLocation(),
    note: document.getElementById('f-note').value,
    couponCode:   state.couponCode   || '',
    appliedPrice: state.appliedPrice || '',
  };

  try {
    if (CONFIG.GAS_URL !== 'YOUR_GAS_DEPLOY_URL') {
      // GAS CORS対応: URLパラメータにJSONを乗せてGETで送信
      // ※ POSTはGASリダイレクト時にbodyが消えるためGETを使用
      const encoded = encodeURIComponent(JSON.stringify(payload));
      const res = await fetch(CONFIG.GAS_URL + '?booking=' + encoded, {
        redirect: 'follow',
      });
      const text = await res.text();
      console.log('GAS response:', text);
      const result = JSON.parse(text);
      if (!result.success) throw new Error(result.error || '送信に失敗しました');
    }
    document.getElementById('confirm-email').textContent = payload.email;
    goStep(5);
  } catch(e) {
    console.error('Submit error:', e);
    btn.disabled = false;
    btn.textContent = '予約リクエストを送信';
    const err = document.getElementById('submit-error');
    err.style.display = 'block';
    err.innerHTML = `送信に失敗しました。お手数ですが、時間をおいて再度お試しいただくか、<br>メール（<a href="mailto:harin.photograph@gmail.com" style="color:var(--red);">harin.photograph@gmail.com</a>）までご連絡ください。<br><small style="color:var(--fg3);">このフォームからの送信を引き続きご利用いただけます。</small>`;
  }
}

// ---- クーポン判定 ----
function applyCoupon() {
  const code = document.getElementById('f-coupon').value.trim().toUpperCase();
  const msg  = document.getElementById('coupon-msg');
  const def  = CONFIG.COUPONS[code];
  if (!def || !def.active) {
    msg.style.color = 'var(--red)';
    msg.textContent = '※ このコードは無効です';
    state.couponApplied = false; state.couponCode = null; state.appliedPrice = null;
    return;
  }
  const shootDate = state.selectedDate;
  if (!shootDate || shootDate < def.validFrom || shootDate > def.validTo) {
    msg.style.color = 'var(--red)';
    msg.textContent = `※ このコードは撮影日が${def.validFrom}〜${def.validTo}の予約が対象です`;
    state.couponApplied = false; state.couponCode = null; state.appliedPrice = null;
    return;
  }
  const dow       = new Date(state.selectedDate + 'T00:00:00').getDay();
  const isWeekend = (dow === 0 || dow === 6);
  state.appliedPrice  = isWeekend ? def.weekendPrice : def.weekdayPrice;
  state.couponApplied = true;
  state.couponCode    = code;
  msg.style.color = 'var(--green)';
  msg.textContent = `✓ ${def.label}が適用されました（¥${state.appliedPrice.toLocaleString()} / 1枠）`;
}

function resetCoupon() {
  state.couponApplied = false; state.couponCode = null; state.appliedPrice = null;
  const msg = document.getElementById('coupon-msg');
  if (msg) msg.textContent = '';
}

