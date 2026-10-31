#pragma once
static const char piko_home_html[] =
"<!doctype html>\n"
"<html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
"<title>PIKO · DCCExpress</title>\n"
"<style>:root{color-scheme:dark}body{margin:0;background:#101722;color:#e9eff7;font:15px system-ui}main{max-width:1000px;margin:22px auto;padding:22px}.links{display:flex;flex-wrap:wrap;gap:10px}a{display:inline-block;text-decoration:none;color:#fff;background:#225d82;border-radius:9px;padding:12px 16px}.card{background:#1b2738;border-radius:14px;padding:20px;margin-top:16px}.muted{color:#aebed1}.warn{color:#ffd086}pre{background:#101722;border-radius:10px;padding:15px;max-height:380px;overflow:auto;white-space:pre-wrap}</style>\n"
"<main><h1>PIKO SmartControl WLAN · DCCExpress</h1><p class=\"muted\">OEM-style number keypad firmware · GPIO event queue, row-step freeze and factory digit code mapping.</p>\n"
"<div class=\"links\"><a href=\"/keymap\">Test 0–9 digits</a><a href=\"/ota\">Firmware update</a><a href=\"/lcd\">Experimental LCD profiles (manual)</a></div>\n"
"<div class=\"card\"><h2>Keypad status</h2><p id=\"state\">Reading…</p><p id=\"last\"></p></div>\n"
"<div class=\"card\"><h2>Recent device events</h2><pre id=\"events\">Loading…</pre></div>\n"
"<p class=\"warn\">STOP and navigation keys are not mapped. DCC/Z21 train control is disabled. LCD SPI guesses are not started automatically.</p>\n"
"<script>\n"
"async function refresh(){try{const [d,e]=await Promise.all([fetch('/api/diag',{cache:'no-store'}),fetch('/api/events',{cache:'no-store'})]);if(!d.ok||!e.ok)throw Error('HTTP error');const info=await d.json(),events=await e.json();if(info.mode!=='oem-numeric')throw Error('Old firmware');document.getElementById('state').textContent=(info.ready?'Ready':'Keypad not ready')+' · row '+info.selectedRow+' · queued '+info.queued;document.getElementById('last').textContent=info.lastDigit<0?'No digit received yet':'Last digit candidate: '+info.lastDigit+' (OEM 0x'+Number(info.lastCode||0).toString(16).toUpperCase()+')';document.getElementById('events').textContent=events.slice(-25).join('\\n')||'No events yet'}catch(err){document.getElementById('state').textContent='Offline / '+err.message}}\n"
"setInterval(refresh,400);refresh();\n"
"</script></main></html>\n";
