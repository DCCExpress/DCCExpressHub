import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cable, CircleHelp, Code2, Database, Eye, ListTree, PlugZap, RefreshCcw, Send, ShieldAlert, Terminal, Wifi, WifiOff } from "lucide-react";
import { BASE, DEFAULT_TYPES, format, jsonPath, needsWriteConfirmation, parseIncoming, wsUrl, type LogRecord } from "./protocol";

type Status = "disconnected" | "connecting" | "connected";
type Tab = "explorer" | "socket" | "log";
const presets = [
  { label: "Ping", value: '{"type":"ping"}' },
  { label: "Sensors", value: '{"list":"sensors"}' },
  { label: "Turnouts", value: '{"list":"turnouts"}' },
  { label: "Power", value: '{"type":"power"}' },
  { label: "Panels", value: '{"list":"panels"}' },
  { label: "Memories", value: '{"list":"memories"}' },
  { label: "Throttle #18 (acquires handle)", value: '{"type":"throttle","data":{"name":"HubDebug18","address":18}}' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("explorer");
  const [status, setStatus] = useState<Status>("disconnected");
  const [type, setType] = useState("sensor");
  const [name, setName] = useState("");
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [entries, setEntries] = useState<unknown>(null);
  const [selected, setSelected] = useState<unknown>(null);
  const [httpError, setHttpError] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('{"type":"ping"}');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [filter, setFilter] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const logId = useRef(0);
  const log = useCallback((channel: LogRecord["channel"], direction: LogRecord["direction"], message: string) => {
    setLogs(old => [...old, { id: ++logId.current, at: new Date().toLocaleTimeString(), channel, direction, message }].slice(-350));
  }, []);

  const httpGet = useCallback(async (url: string): Promise<unknown> => {
    setBusy(true);
    setHttpError("");
    log("HTTP", "out", "GET " + url);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.text();
      const data = parseIncoming(body);
      log("HTTP", response.ok ? "in" : "error", response.status + " " + format(data));
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + body.slice(0, 400));
      return data;
    } catch (error) {
      const message = String(error);
      setHttpError(message);
      log("SYSTEM", "error", message);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [log]);

  const loadList = useCallback(async (chosen = type) => {
    try {
      setSelected(null);
      setEntries(await httpGet(jsonPath(chosen)));
    } catch { setEntries(null); }
  }, [type, httpGet]);

  const inspect = useCallback(async (key: string, chosen = type) => {
    try { setSelected(await httpGet(jsonPath(chosen, key))); }
    catch { setSelected(null); }
  }, [type, httpGet]);

  const discover = useCallback(async () => {
    try {
      const result = await httpGet(jsonPath("type"));
      const values = Array.isArray(result) ? result : [];
      const mapped = values.flatMap((x): string[] => typeof x === "string" ? [x] :
        x && typeof x === "object" && "data" in x && typeof x.data === "object" && x.data !== null && "name" in x.data && typeof x.data.name === "string" ? [x.data.name] : []);
      if (mapped.length) setTypes([...new Set([...DEFAULT_TYPES, ...mapped])]);
      setSelected(result);
    } catch { /* Already shown in diagnostic log. */ }
  }, [httpGet]);

  const connect = useCallback(() => {
    if (socket.current) socket.current.close();
    setStatus("connecting");
    const ws = new WebSocket(wsUrl());
    socket.current = ws;
    log("SYSTEM", "info", "Connecting to " + wsUrl());
    ws.onopen = () => {
      if (socket.current !== ws) return;
      setStatus("connected");
      log("SYSTEM", "info", "WebSocket connected");
    };
    ws.onmessage = event => {
      log("WS", "in", typeof event.data === "string" ? event.data : "[binary message]");
    };
    ws.onerror = () => log("SYSTEM", "error", "WebSocket error (check JMRI Web Server and proxy)");
    ws.onclose = event => {
      if (socket.current !== ws) return;
      socket.current = null;
      setStatus("disconnected");
      log("SYSTEM", "info", "WebSocket closed (" + event.code + ")");
    };
  }, [log]);

  const disconnect = () => {
    socket.current?.close();
    socket.current = null;
    setStatus("disconnected");
  };

  useEffect(() => () => { socket.current?.close(); socket.current = null; }, []);

  const send = () => {
    if (status !== "connected" || socket.current?.readyState !== WebSocket.OPEN) return;
    let parsed: unknown;
    try { parsed = JSON.parse(input); }
    catch (error) { log("SYSTEM", "error", "Invalid JSON: " + String(error)); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      log("SYSTEM", "error", "Expected a JSON command object");
      return;
    }
    // Never silently issue writes: all mutations, including ambiguous commands, need confirmation.
    if (needsWriteConfirmation(input) &&
      !window.confirm("This may change your railway hardware state. Send this JMRI command?")) return;
    socket.current.send(input);
    log("WS", "out", input);
  };

  const rows = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : [];
  const labelOf = (item: unknown, index: number) => {
    if (!item || typeof item !== "object") return "#" + (index + 1);
    const v = item as Record<string, unknown>;
    const d = v.data && typeof v.data === "object" ? v.data as Record<string, unknown> : v;
    return String(d.name ?? d.userName ?? v.name ?? "#" + (index + 1));
  };
  const filteredLogs = logs.filter(item => !filter || (item.channel + item.message).toLowerCase().includes(filter.toLowerCase()));

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandicon"><Activity size={22}/></span><div><strong>DCCExpressHub</strong><small>JMRI LAB · alpha6</small></div></div>
      <div className="nav-caption">WORKSPACE</div>
      <button className={tab === "explorer" ? "nav active" : "nav"} onClick={() => setTab("explorer")}><Database size={17}/> Object explorer</button>
      <button className={tab === "socket" ? "nav active" : "nav"} onClick={() => setTab("socket")}><Terminal size={17}/> WebSocket console</button>
      <button className={tab === "log" ? "nav active" : "nav"} onClick={() => setTab("log")}><ListTree size={17}/> Event log <span className="count">{logs.length}</span></button>
      <div className="side-bottom"><div className="side-heading"><ShieldAlert size={15}/> Debug environment</div><p>Not connected to the Hub runtime. Writes require confirmation, but can operate real hardware.</p></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">JMRI CONNECTIVITY / EXPERIMENTAL</div><h1>{tab === "explorer" ? "JSON Object Explorer" : tab === "socket" ? "WebSocket Console" : "Event Log"}</h1><p>Explore the live JMRI API before designing a full UI integration.</p></div><span className={"status " + status}>{status === "connected" ? <Wifi size={16}/> : <WifiOff size={16}/>} {status}</span></header>
      <section className="endpoint"><div><small>JMRI WEB SERVER · DEVELOPMENT PROXY</small><div className="endpoint-url"><Cable size={17}/> /jmri → <code>JMRI_TARGET</code> <span className="muted">(default 127.0.0.1:12080)</span></div></div><div className="actions"><button className="button secondary" onClick={() => void discover()} disabled={busy}><RefreshCcw size={16}/> Discover types</button><button className="button primary" onClick={status === "disconnected" ? connect : disconnect} disabled={status === "connecting"}><PlugZap size={16}/>{status === "disconnected" ? "Connect WS" : status === "connecting" ? "Connecting…" : "Disconnect"}</button></div></section>
      {httpError && <div className="error"><ShieldAlert size={17}/><span>{httpError}</span></div>}
      {tab === "explorer" && <div className="workgrid">
        <section className="panel catalog"><div className="panel-title"><div><Database size={17}/><strong>Objects</strong></div><span className="tag">HTTP GET</span></div><div className="panel-body"><label>Object type</label><div className="stackrow"><select value={type} onChange={e => { setType(e.target.value); setEntries(null); setSelected(null); }}>{types.map(x => <option key={x} value={x}>{x}</option>)}</select><button className="button primary" disabled={busy} onClick={() => void loadList()}><RefreshCcw size={15}/> List</button></div><label>Inspect by system/user name</label><div className="stackrow"><input placeholder="e.g. IS1001, LT20, IM..." value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && name.trim()) void inspect(name.trim()); }}/><button className="button secondary" disabled={busy || !name.trim()} onClick={() => void inspect(name.trim())}><Eye size={16}/></button></div><div className="divider"/><div className="list-header">RESPONSE ITEMS <span>{rows.length}</span></div><div className="items">{rows.length ? rows.slice(0, 250).map((item, idx) => <button key={idx} className="item" onClick={() => { setSelected(item); const entryName = labelOf(item, idx); if (!entryName.startsWith("#")) setName(entryName); }}><span><Database size={14}/>{labelOf(item,idx)}</span><span className="muted">›</span></button>) : <div className="empty"><Database size={25}/><span>Choose a type and click List.<br/>No hardware needed for protocol exploration.</span></div>}</div>{rows.length > 250 && <p className="muted">Showing first 250 entries. Raw JSON contains all results.</p>}</div></section>
        <section className="panel output"><div className="panel-title"><div><Code2 size={17}/><strong>JSON response</strong></div><span className="tag">READ ONLY</span></div><div className="panel-body"><div className="jsonmeta"><span>{selected !== null ? "Selected object" : "List response"}</span><button className="textbutton" onClick={() => navigator.clipboard?.writeText(format(selected ?? entries))}><ArrowDownToLine size={14}/> Copy JSON</button></div><pre className="json">{selected !== null || entries !== null ? format(selected ?? entries) : '// Select an object type to inspect JMRI response payloads.\n// State codes, addresses and supported fields are shown raw.'}</pre></div></section>
      </div>}
      {tab === "socket" && <div className="workgrid"><section className="panel catalog"><div className="panel-title"><div><Terminal size={17}/><strong>Send JSON message</strong></div><span className="tag">WS /json</span></div><div className="panel-body"><label>Example commands</label><div className="presets">{presets.map(item=><button key={item.label} className="chip" onClick={() => setInput(item.value)}>{item.label}</button>)}</div><label>Raw JSON payload</label><textarea spellCheck={false} value={input} onChange={e => setInput(e.target.value)} rows={12}/><button className="button primary wide" disabled={status!=="connected"} onClick={send}><Send size={16}/> Send message</button><p className="muted note"><ShieldAlert size={15}/> Read commands may register live listeners. Mutation commands require confirmation. A throttle request may acquire control of a locomotive.</p></div></section><section className="panel output"><div className="panel-title"><div><Activity size={17}/><strong>Socket events</strong></div><span className="tag">{logs.filter(x=>x.channel==="WS").length} MESSAGES</span></div><div className="panel-body eventarea">{logs.filter(x=>x.channel==="WS").length ? logs.filter(x=>x.channel==="WS").slice(-60).reverse().map(item=><div key={item.id} className="event"><div className="eventhead">{item.direction==="in"?<ArrowDownToLine size={14}/>:<ArrowUpFromLine size={14}/>} {item.direction.toUpperCase()} · {item.at}</div><pre>{item.message}</pre></div>) : <div className="empty"><Wifi size={28}/>Connect WebSocket and send a ping, or subscribe to sensors.</div>}</div></section></div>}
      {tab === "log" && <section className="panel"><div className="panel-title"><div><ListTree size={17}/><strong>Session diagnostics</strong></div><div className="actions"><button className="textbutton" onClick={() => navigator.clipboard?.writeText(format(filteredLogs))}><ArrowDownToLine size={14}/> Export JSON</button><button className="textbutton" onClick={()=>setLogs([])}>Clear</button></div></div><div className="panel-body"><input placeholder="Filter HTTP, WS, errors, payloads…" value={filter} onChange={e=>setFilter(e.target.value)}/><div className="eventarea logarea">{filteredLogs.slice().reverse().map(item=><div className="event" key={item.id}><div className="eventhead">{item.at} · {item.channel} · <span className={item.direction}>{item.direction.toUpperCase()}</span></div><pre>{item.message}</pre></div>)}{filteredLogs.length===0&&<div className="empty">No events yet.</div>}</div></div></section>}
      <footer><CircleHelp size={15}/> Protocol reference: <a href="https://www.jmri.org/help/en/html/web/JsonServlet.shtml" target="_blank" rel="noreferrer">JMRI JSON Servlet</a> · <a href="https://www.jmri.org/JavaDoc/doc/jmri/server/json/package-summary.html" target="_blank" rel="noreferrer">Versioned JSON API</a> <span>Standalone experiment — no Hub changes</span></footer>
    </main>
  </div>;
}
