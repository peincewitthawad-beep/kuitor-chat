"use strict";

// คุยต่อ: static GitHub Pages client + Supabase Auth, Postgres (RLS), Realtime.
// Never put a secret/service_role key here. RLS in supabase.sql is essential.
const $ = (id) => document.getElementById(id);
const state = {
  client: null, me: null, mode: "login", rooms: [], active: null, channel: null,
  realtimeReady: false, refreshTimer: null, heartbeatTimer: null,
  firstId: null, hasOlder: false, loadingMore: false,
  bootCount: 0, recovering: false, inviteBusy: false,
};
const MSG_PAGE = 50;
const CHAT_SELECT = "id,room_id,sender_id,content,created_at,sender:profiles!messages_sender_id_fkey(display_name)";

function text(value) { return String(value ?? ""); }
function initial(value) { return Array.from(text(value))[0]?.toUpperCase() || "?"; }
function dateTime(iso) { return new Date(iso).toLocaleString("th-TH", {dateStyle: "short", timeStyle: "short"}); }
function friendlyError(error) {
  const message = text(error?.message || "มีข้อผิดพลาด โปรดลองอีกครั้ง");
  if (/Invalid login credentials/i.test(message)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/Email not confirmed/i.test(message)) return "กรุณายืนยันอีเมลจากจดหมายที่ Supabase ส่งให้ก่อน";
  if (/User already registered/i.test(message)) return "มีบัญชีอีเมลนี้แล้ว กรุณาเข้าสู่ระบบ";
  if (/Invalid invitation code/i.test(message)) return "รหัสเชิญไม่ถูกต้อง หรือถูกยกเลิกแล้ว";
  if (/Database error saving new user/i.test(message)) return "ยังตั้งค่าฐานข้อมูลไม่สมบูรณ์: ตรวจว่าได้รัน supabase.sql แล้ว";
  return message;
}
function errorAt(id, msg) { const el = $(id); el.textContent = msg; el.hidden = false; }
function clearError(id) { $(id).hidden = true; $(id).textContent = ""; }
function toast(message) {
  const el = $("toast"); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3600);
}
function setMode(mode) {
  state.mode = mode;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("loginTab").setAttribute("aria-selected", String(mode === "login"));
  $("registerTab").setAttribute("aria-selected", String(mode === "register"));
  $("nameField").hidden = mode !== "register";
  $("displayName").required = mode === "register";
  $("authTitle").textContent = mode === "login" ? "ยินดีต้อนรับกลับ" : "สร้างบัญชีใหม่";
  $("authDescription").textContent = mode === "login" ? "ล็อกอินด้วยอีเมลเดิม เพื่ออ่านแชตย้อนหลัง" : "สมัครสมาชิกเพื่อเริ่มคุยและเก็บประวัติแชต";
  $("authSubmit").firstChild.textContent = mode === "login" ? "เข้าสู่ระบบ " : "สร้างบัญชี ";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("resetPasswordButton").hidden = mode !== "login";
  clearError("authError"); $("authInfo").hidden = true;
}
function teardownApp() {
  ++state.bootCount;
  clearInterval(state.refreshTimer); clearInterval(state.heartbeatTimer);
  state.refreshTimer = null; state.heartbeatTimer = null;
  if (state.channel && state.client) state.client.removeChannel(state.channel);
  state.channel = null; state.realtimeReady = false;
  state.me = null; state.active = null; state.rooms = []; state.firstId = null;
  $("devicesModal").hidden = true;
}
function showAuth() {
  teardownApp(); $("authView").hidden = false; $("appView").hidden = true;
  $("setupView").hidden = true; $("appView").classList.remove("mobile-chat");
  $("password").value = "";
  if (!state.recovering) $("recoveryForm").hidden = true;
}
function showSetup(error) {
  $("authView").hidden = true; $("appView").hidden = true;
  $("setupView").hidden = false;
  if (error) errorAt("setupError", text(error));
}
function validSetup(config) {
  if (!config || !/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(config.supabaseUrl ?? "")) return false;
  const key = text(config.supabasePublishableKey);
  return key.startsWith("sb_publishable_") || (key.startsWith("eyJ") && key.length > 100);
}
function currentName() {
  return state.me?.user_metadata?.display_name || state.me?.email?.split("@")[0] || "สมาชิก";
}
function uuid() {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const bytes = new Uint8Array(1); crypto.getRandomValues(bytes);
      const n = bytes[0] & 15; return (c === "x" ? n : (n & 3 | 8)).toString(16);
    });
}
function deviceId() {
  try {
    let id = localStorage.getItem("kuitor-device-v1");
    if (!id) { id = uuid(); localStorage.setItem("kuitor-device-v1", id); }
    return id;
  } catch (_e) { return uuid(); }
}
const thisDeviceId = deviceId();
async function heartbeat() {
  if (!state.me) return;
  const platform = navigator.userAgentData?.platform || navigator.platform || "อุปกรณ์";
  const label = `${platform} · เบราว์เซอร์`.slice(0, 120);
  const {error} = await state.client.from("devices").upsert({
    id: thisDeviceId, user_id: state.me.id, label, last_seen: new Date().toISOString(),
  }, {onConflict: "user_id,id"});
  if (error) console.warn("Device heartbeat failed", friendlyError(error));
}
async function showApp(user) {
  // Do not reinitialize app for token refresh of the same user.
  if (state.me?.id === user.id && !$("appView").hidden) return;
  teardownApp();
  state.me = user;
  const boot = state.bootCount;
  $("authView").hidden = true; $("setupView").hidden = true; $("appView").hidden = false;
  $("chatEmpty").hidden = false; $("chatScreen").hidden = true;
  $("appView").classList.remove("mobile-chat");
  $("ownUsername").textContent = currentName(); $("ownAvatar").textContent = initial(currentName());
  $("ownEmail").textContent = user.email || "บัญชีของฉัน";
  await Promise.all([refreshRooms(), heartbeat()]).catch(e => toast(friendlyError(e)));
  if (boot !== state.bootCount) return;
  state.heartbeatTimer = setInterval(() => { heartbeat().catch(() => {}); }, 60000);
  state.refreshTimer = setInterval(async () => {
    if (!state.me) return;
    await refreshRooms().catch(() => {});
    if (state.active) await refreshLatestMessages().catch(() => {});
  }, 12000);
  if (new URL(location.href).searchParams.has("invite")) await joinPendingInvite();
}
function pendingInvitation() { return new URL(location.href).searchParams.get("invite"); }
function clearPendingInvitation() {
  const url = new URL(location.href); url.searchParams.delete("invite");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function findInviteCode(value) {
  const raw = text(value).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return findInviteCode(u.searchParams.get("invite") || "");
  } catch (_e) { return null; }
}
async function joinPendingInvite() {
  const code = pendingInvitation();
  if (!code || !state.me || state.inviteBusy) return;
  try {
    await joinRoom(code);
    clearPendingInvitation();
  } catch (e) { toast("เข้าร่วมห้องไม่สำเร็จ: " + friendlyError(e)); }
}
async function refreshRooms() {
  const userId = state.me?.id; if (!userId) return;
  const {data, error} = await state.client.from("rooms")
    .select("id,title,created_by,invite_code,created_at").order("created_at", {ascending: false}).limit(100);
  if (error) throw error;
  if (state.me?.id !== userId) return;
  state.rooms = data || [];
  $("chatCount").textContent = String(state.rooms.length);
  renderRooms();
}
function renderRooms() {
  const list = $("conversationList"); list.replaceChildren();
  if (!state.rooms.length) {
    const blank = document.createElement("p"); blank.className = "blank-list";
    blank.textContent = "ยังไม่มีห้องสนทนา\nสร้างห้องใหม่หรือใช้ลิงก์เชิญเพื่อเข้าร่วม";
    list.append(blank); return;
  }
  for (const room of state.rooms) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "conversation" + (room.id === state.active ? " selected" : "");
    const avatar = document.createElement("div"); avatar.className = "avatar avatar-purple"; avatar.textContent = initial(room.title);
    const content = document.createElement("div"); content.className = "conv-content";
    const title = document.createElement("div"); title.className = "conv-title"; title.textContent = room.title;
    const sub = document.createElement("div"); sub.className = "conv-preview"; sub.textContent = "แตะเพื่ออ่านหรือส่งข้อความ";
    content.append(title, sub);
    const time = document.createElement("span"); time.className = "conv-time";
    time.textContent = new Date(room.created_at).toLocaleDateString("th-TH", {day:"numeric",month:"short"});
    button.append(avatar, content, time);
    button.addEventListener("click", () => openRoom(room.id)); list.append(button);
  }
}
async function createRoom(title) {
  const {data,error} = await state.client.rpc("create_room", {p_title: title.trim()});
  if (error) throw error;
  await refreshRooms(); await openRoom(data);
  toast("สร้างห้องแล้ว ส่งลิงก์เชิญให้เพื่อนเข้ามาคุยได้");
}
async function joinRoom(value) {
  const code = findInviteCode(value);
  if (!code) throw new Error("กรุณาวางลิงก์หรือรหัสเชิญให้ถูกต้อง");
  state.inviteBusy = true;
  try {
    const {data,error} = await state.client.rpc("join_room", {p_invite_code: code});
    if (error) throw error;
    await refreshRooms(); await openRoom(data);
    toast("เข้าร่วมห้องสนทนาแล้ว");
  } finally { state.inviteBusy = false; }
}
async function openRoom(roomId) {
  const room = state.rooms.find(r => r.id === roomId);
  if (!room || !state.me) return;
  state.active = roomId; state.firstId = null; state.hasOlder = false;
  $("chatPerson").textContent = room.title; $("chatAvatar").textContent = initial(room.title);
  $("rotateInviteButton").hidden = room.created_by !== state.me.id;
  $("chatEmpty").hidden = true; $("chatScreen").hidden = false;
  $("appView").classList.add("mobile-chat"); $("messageList").replaceChildren();
  $("olderButton").hidden = true; $("sendError").hidden = true;
  $("messageInput").value = ""; updateStatus(); renderRooms();
  if (state.channel) { await state.client.removeChannel(state.channel); state.channel = null; }
  state.realtimeReady = false;
  await loadInitialMessages(roomId);
  if (state.active !== roomId || !state.me) return;
  state.channel = state.client.channel("chat-" + roomId)
    .on("postgres_changes", {event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq." + roomId},
      () => { refreshLatestMessages().catch(() => {}); })
    .subscribe(status => {
      if (state.active !== roomId) return;
      state.realtimeReady = status === "SUBSCRIBED";
      updateStatus();
      if (state.realtimeReady) refreshLatestMessages().catch(() => {});
    });
  $("messageInput").focus();
}
function updateStatus() {
  $("connectionStatus").textContent = state.realtimeReady ? "ข้อความเรียลไทม์พร้อมใช้" : "กำลังเชื่อมต่อ · ตรวจข้อความอัตโนมัติ";
  $("statusDot").classList.toggle("on", state.realtimeReady);
}
function renderMessage(message, {prepend = false, noScroll = false} = {}) {
  if (!state.active || message.room_id !== state.active) return;
  const list = $("messageList");
  if (list.querySelector(`[data-message-id="${message.id}"]`)) return;
  const mine = message.sender_id === state.me?.id;
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrap" + (mine ? " mine" : ""); wrapper.dataset.messageId = String(message.id);
  if (!mine) {
    const author = document.createElement("div"); author.className = "message-author";
    author.textContent = message.sender?.display_name || ("สมาชิก " + text(message.sender_id).slice(0, 6)); wrapper.append(author);
  }
  const bubble = document.createElement("div"); bubble.className = "message-bubble"; bubble.textContent = message.content;
  const time = document.createElement("time"); time.className = "message-date";
  time.dateTime = message.created_at; time.textContent = dateTime(message.created_at);
  wrapper.append(bubble, time);
  if (prepend) list.prepend(wrapper); else list.append(wrapper);
  if (!state.firstId || Number(message.id) < state.firstId) state.firstId = Number(message.id);
  if (!noScroll && !prepend) $("messageArea").scrollTop = $("messageArea").scrollHeight;
}
async function getMessages(roomId, beforeId = null) {
  let query = state.client.from("messages").select(CHAT_SELECT).eq("room_id", roomId)
    .order("id", {ascending: false}).limit(MSG_PAGE);
  if (beforeId != null) query = query.lt("id", beforeId);
  const {data,error} = await query;
  if (error) throw error;
  return (data || []).reverse();
}
async function loadInitialMessages(roomId) {
  try {
    const data = await getMessages(roomId);
    if (state.active !== roomId) return;
    $("messageList").replaceChildren(); state.firstId = null;
    for (const m of data) renderMessage(m, {noScroll:true});
    state.hasOlder = data.length === MSG_PAGE; $("olderButton").hidden = !state.hasOlder;
    $("messageArea").scrollTop = $("messageArea").scrollHeight;
  } catch (e) { if (state.active === roomId) toast("โหลดข้อความไม่ได้: " + friendlyError(e)); }
}
async function refreshLatestMessages() {
  const roomId = state.active; if (!roomId || !state.me) return;
  const list = $("messageList");
  const lastId = Number(list.lastElementChild?.dataset.messageId || 0);
  const shouldStick = $("messageArea").scrollHeight - $("messageArea").scrollTop - $("messageArea").clientHeight < 125;
  // Fetch all new messages, not only the last page, to avoid losing bursts >50.
  let from = lastId;
  for (let page = 0; page < 20; page++) {
    const {data,error} = await state.client.from("messages").select(CHAT_SELECT)
      .eq("room_id", roomId).gt("id", from).order("id", {ascending: true}).limit(MSG_PAGE);
    if (error) throw error;
    if (state.active !== roomId || !state.me) return;
    if (!data?.length) break;
    for (const m of data) renderMessage(m, {noScroll:true});
    from = Number(data[data.length - 1].id);
    if (data.length < MSG_PAGE) break;
  }
  if (shouldStick) $("messageArea").scrollTop = $("messageArea").scrollHeight;
}
async function loadOlder() {
  const roomId = state.active;
  if (!roomId || !state.firstId || !state.hasOlder || state.loadingMore) return;
  state.loadingMore = true;
  $("olderButton").disabled = true;
  try {
    const beforeHeight = $("messageArea").scrollHeight;
    const data = await getMessages(roomId, state.firstId);
    if (state.active !== roomId) return;
    for (const m of [...data].reverse()) renderMessage(m, {prepend:true,noScroll:true});
    state.hasOlder = data.length === MSG_PAGE;
    $("olderButton").hidden = !state.hasOlder;
    $("messageArea").scrollTop += $("messageArea").scrollHeight - beforeHeight;
  } catch (e) { toast("โหลดข้อความเก่าไม่สำเร็จ: " + friendlyError(e)); }
  finally { state.loadingMore = false; $("olderButton").disabled = false; }
}
async function sendMessage(content) {
  if (!state.active || !state.me) return;
  const roomId = state.active;
  const {error} = await state.client.from("messages").insert({
    room_id: roomId, sender_id: state.me.id, content: content.trim(),
  });
  if (error) throw error;
  if (state.active === roomId) await refreshLatestMessages();
}
async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(value); return; }
  const input = document.createElement("textarea"); input.value = value;
  input.style.position = "fixed"; input.style.left = "-9999px"; document.body.append(input);
  input.select(); const ok = document.execCommand("copy"); input.remove();
  if (!ok) throw new Error("ไม่สามารถคัดลอกอัตโนมัติได้");
}
async function shareActiveRoom() {
  const room = state.rooms.find(r => r.id === state.active); if (!room) return;
  const url = new URL(location.href); url.search = ""; url.hash = "";
  url.searchParams.set("invite", room.invite_code);
  await copyText(url.toString()); toast("คัดลอกลิงก์เชิญแล้ว · ส่งให้คนที่ต้องการให้เข้าห้องเท่านั้น");
}
async function rotateInvite() {
  const room = state.rooms.find(r => r.id === state.active);
  if (!room || room.created_by !== state.me?.id) return;
  if (!confirm("ลิงก์เชิญเก่าจะใช้เข้าห้องไม่ได้อีกต่อไป (สมาชิกเดิมยังอยู่) ต้องการเปลี่ยนหรือไม่?")) return;
  const {error} = await state.client.rpc("rotate_invite_code", {p_room_id: room.id});
  if (error) throw error;
  await refreshRooms(); toast("เปลี่ยนลิงก์เชิญแล้ว สามารถกดแชร์ห้องเพื่อคัดลอกลิงก์ใหม่");
}
async function showDevices() {
  if (!state.me) return;
  const {data,error} = await state.client.from("devices")
    .select("id,label,last_seen").order("last_seen", {ascending:false}).limit(100);
  if (error) throw error;
  const list = $("deviceList"); list.replaceChildren();
  if (!data?.length) {
    const p = document.createElement("p"); p.className = "muted"; p.textContent = "ยังไม่มีข้อมูลอุปกรณ์"; list.append(p);
  }
  for (const device of data || []) {
    const entry = document.createElement("div"); entry.className = "device";
    const symbol = document.createElement("span"); symbol.className = "device-symbol"; symbol.textContent = "▣";
    const details = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = device.label;
    const seen = document.createElement("small"); seen.textContent = "เข้าถึงล่าสุด: " + dateTime(device.last_seen);
    details.append(name,seen); entry.append(symbol,details);
    if (device.id === thisDeviceId) {
      const tag = document.createElement("span"); tag.className = "active-pill"; tag.textContent = "เครื่องนี้"; entry.append(tag);
    }
    list.append(entry);
  }
  $("devicesModal").hidden = false;
}
async function authSubmit(event) {
  event.preventDefault(); clearError("authError"); $("authInfo").hidden = true;
  const email = $("email").value.trim(); const password = $("password").value;
  const button = $("authSubmit"); button.disabled = true;
  try {
    if (state.mode === "register") {
      const displayName = $("displayName").value.trim();
      if (!displayName || displayName.length > 40) throw new Error("กรุณากรอกชื่อที่แสดง ไม่เกิน 40 ตัวอักษร");
      const {data,error} = await state.client.auth.signUp({ email, password, options: {
        data: {display_name: displayName}, emailRedirectTo: location.origin + location.pathname,
      }});
      if (error) throw error;
      if (!data.session) {
        $("authInfo").textContent = "สมัครสมาชิกแล้ว หากเปิดการยืนยันอีเมล กรุณาเปิดอีเมลยืนยันก่อนล็อกอิน";
        $("authInfo").hidden = false;
      }
    } else {
      const {error} = await state.client.auth.signInWithPassword({email,password});
      if (error) throw error;
    }
  } catch (e) { errorAt("authError", friendlyError(e)); }
  finally { button.disabled = false; }
}
async function startReset() {
  clearError("authError");
  const email = $("email").value.trim();
  if (!email || !$("email").checkValidity()) { errorAt("authError", "กรุณากรอกอีเมลของบัญชีก่อน"); return; }
  try {
    const {error} = await state.client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw error;
    $("authInfo").textContent = "ถ้าพบบัญชีนี้ ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านทางอีเมล";
    $("authInfo").hidden = false;
  } catch (e) { errorAt("authError", friendlyError(e)); }
}
function showRecovery() {
  state.recovering = true;
  $("authView").hidden = false; $("appView").hidden = true; $("setupView").hidden = true;
  $("authForm").hidden = true; $("recoveryForm").hidden = false;
  $("resetPasswordButton").hidden = true; $("authTitle").textContent = "ตั้งรหัสผ่านใหม่";
  $("authDescription").textContent = "พิมพ์รหัสผ่านใหม่เพื่อใช้ล็อกอินครั้งต่อไป";
}
async function recoverySubmit(event) {
  event.preventDefault(); clearError("authError");
  try {
    const pass = $("newPassword").value;
    if (pass.length < 8) throw new Error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    const {error} = await state.client.auth.updateUser({password: pass});
    if (error) throw error;
    state.recovering = false; $("authForm").hidden = false; $("recoveryForm").hidden = true;
    $("newPassword").value = "";
    toast("เปลี่ยนรหัสผ่านแล้ว");
    const {data} = await state.client.auth.getUser();
    if (data?.user) await showApp(data.user);
    else showAuth();
  } catch(e) { errorAt("authError", friendlyError(e)); }
}
async function bootstrap() {
  const config = window.KUITOR_CONFIG;
  if (!validSetup(config) || typeof window.supabase?.createClient !== "function") {
    showSetup(typeof window.supabase?.createClient !== "function" ? "โหลดไลบรารี Supabase ไม่สำเร็จ โปรดตรวจอินเทอร์เน็ตหรือปิดส่วนขยายที่บล็อก CDN" : "กรุณาตั้งค่า Supabase Project URL และ Publishable key ก่อน");
    return;
  }
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true},
  });
  state.client.auth.onAuthStateChange((event, session) => {
    // Auth callbacks must not await other Supabase operations directly.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { showRecovery(); return; }
      if (state.recovering) return;
      if (session?.user) showApp(session.user).catch(e => toast(friendlyError(e)));
      else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") showAuth();
    }, 0);
  });
  const {data,error} = await state.client.auth.getSession();
  if (error) { showAuth(); errorAt("authError", friendlyError(error)); return; }
  if (!data.session?.user) showAuth();
  // Other cases are handled by onAuthStateChange(INITIAL_SESSION).
}

$("loginTab").addEventListener("click", () => setMode("login"));
$("registerTab").addEventListener("click", () => setMode("register"));
$("authForm").addEventListener("submit", authSubmit);
$("resetPasswordButton").addEventListener("click", startReset);
$("recoveryForm").addEventListener("submit", recoverySubmit);
$("logoutButton").addEventListener("click", async () => {
  try { const {error} = await state.client.auth.signOut(); if (error) throw error; showAuth(); toast("ออกจากระบบแล้ว · ประวัติแชตไม่ถูกลบ"); }
  catch(e) { toast(friendlyError(e)); }
});
$("createRoomForm").addEventListener("submit", async ev => {
  ev.preventDefault(); clearError("roomError");
  const button = ev.currentTarget.querySelector("button"); button.disabled = true;
  try { await createRoom($("roomTitleInput").value); $("roomTitleInput").value = ""; }
  catch (e) { errorAt("roomError", friendlyError(e)); }
  finally { button.disabled = false; }
});
$("joinRoomForm").addEventListener("submit", async ev => {
  ev.preventDefault(); clearError("roomError");
  const button = ev.currentTarget.querySelector("button"); button.disabled = true;
  try { await joinRoom($("inviteInput").value); $("inviteInput").value = ""; }
  catch (e) { errorAt("roomError", friendlyError(e)); }
  finally { button.disabled = false; }
});
$("messageForm").addEventListener("submit", async ev => {
  ev.preventDefault(); clearError("sendError");
  const input = $("messageInput"); const body = input.value.trim();
  if (!body) return;
  const button = $("sendButton"); button.disabled = true;
  try { await sendMessage(body); input.value = ""; }
  catch(e) { errorAt("sendError", friendlyError(e)); }
  finally { button.disabled = false; input.focus(); }
});
$("olderButton").addEventListener("click", loadOlder);
$("backButton").addEventListener("click", () => $("appView").classList.remove("mobile-chat"));
$("inviteButton").addEventListener("click", () => shareActiveRoom().catch(e => toast(friendlyError(e))));
$("rotateInviteButton").addEventListener("click", () => rotateInvite().catch(e => toast(friendlyError(e))));
$("devicesButton").addEventListener("click", () => showDevices().catch(e => toast(friendlyError(e))));
$("closeDevices").addEventListener("click", () => { $("devicesModal").hidden = true; });
$("devicesModal").addEventListener("click", ev => { if (ev.target === $("devicesModal")) $("devicesModal").hidden = true; });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.me) { heartbeat().catch(() => {}); refreshRooms().catch(() => {}); refreshLatestMessages().catch(() => {}); }
});
window.addEventListener("online", () => { if (state.me) { refreshRooms().catch(() => {}); refreshLatestMessages().catch(() => {}); } });
bootstrap().catch(e => showSetup(friendlyError(e)));
