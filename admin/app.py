"""Relativity admin panel — single-page Streamlit UI.

Run:  streamlit run admin/app.py
"""
from __future__ import annotations
import os, time, hashlib, json
import pandas as pd
import requests
import streamlit as st
from pathlib import Path

st.set_page_config(page_title="Relativity Admin", page_icon=":material/admin_panel_settings:", layout="wide")

_CREDS_FILE = Path(__file__).parent / ".credentials.json"

# ─── Supabase helpers ───────────────────────────────────────────────────────

_BASE = st.session_state.get("sb_url", "").rstrip("/")
_TOKEN = st.session_state.get("sb_key", "")


def _headers(auth: bool = False) -> dict:
    h = {"apikey": _TOKEN, "Content-Type": "application/json"}
    if auth:
        h["Authorization"] = f"Bearer {_TOKEN}"
    return h


@st.cache_data(ttl=30)
def rest(path: str, limit: int = 5000) -> list[dict]:
    if not _BASE or not _TOKEN:
        return []
    url = f"{_BASE}/rest/v1/{path}"
    r = requests.get(url, headers=_headers(auth=True), timeout=30)
    if r.status_code != 200:
        st.warning(f"Query {path}: {r.status_code} — {r.text[:200]}")
        return []
    return r.json() or []


@st.cache_data(ttl=30)
def auth_users() -> list[dict]:
    if not _BASE or not _TOKEN:
        return []
    out, page = [], 1
    while True:
        r = requests.get(
            f"{_BASE}/auth/v1/admin/users",
            headers=_headers(auth=True),
            params={"page": page, "per_page": 1000},
            timeout=30,
        )
        if r.status_code != 200:
            break
        users = r.json().get("users", [])
        out.extend(users)
        if len(users) < 1000:
            break
        page += 1
    return out


def _day(s: str) -> str:
    return s[:10]


def _count_by_day(rows: list[dict], col: str = "created_at", days: int = 30) -> pd.DataFrame:
    import datetime as _dt
    now = _dt.date.today()
    dates = [(now - _dt.timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    counts = {}
    for r in rows:
        d = _day(r.get(col, ""))
        if d in counts:
            counts[d] += 1
    return pd.DataFrame({"date": dates, "count": [counts.get(d, 0) for d in dates]})


def _top_n(rows: list[dict], col: str, n: int = 15) -> pd.DataFrame:
    from collections import Counter
    c = Counter(r.get(col, "unknown") for r in rows if r.get(col))
    items = c.most_common(n)
    return pd.DataFrame({"name": [x[0] for x in items], "count": [x[1] for x in items]})


# ─── Auth gate ───────────────────────────────────────────────────────────────

def _check_pw() -> bool:
    if "authed" in st.session_state:
        return True
    if "admin_pw" not in st.session_state:
        return False
    return False


if not _check_pw():
    # Try loading saved credentials
    saved = {}
    if _CREDS_FILE.exists():
        try:
            saved = json.loads(_CREDS_FILE.read_text())
        except Exception:
            pass

    # Auto-login if we have saved credentials and no password gate is enforced
    env_url = os.environ.get("SUPABASE_URL", "")
    env_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    env_pw = os.environ.get("ADMIN_PASSWORD", "")
    expected = os.environ.get("ADMIN_HASH", "")
    if saved.get("sb_url") and saved.get("sb_key") and not expected and not env_pw:
        st.session_state["sb_url"] = saved["sb_url"]
        st.session_state["sb_key"] = saved["sb_key"]
        st.session_state["authed"] = True

    if not _check_pw():
        st.markdown("### Relativity Admin")
        sb_url = st.text_input("Supabase URL", value=st.session_state.get("sb_url", saved.get("sb_url", env_url)))
        sb_key = st.text_input("Service Role Key", type="password", value=st.session_state.get("sb_key", saved.get("sb_key", env_key)))
        admin_pw = st.text_input("Admin password", type="password", value=st.session_state.get("admin_pw", saved.get("admin_pw", "")))
        save = st.checkbox("Save credentials locally", value=bool(saved))
        if st.button("Enter"):
            h = hashlib.sha256(admin_pw.encode()).hexdigest() if admin_pw else ""
            valid = (not expected and not env_pw) or (env_pw and admin_pw == env_pw) or (expected and h == expected)
            if valid:
                st.session_state["sb_url"] = sb_url
                st.session_state["sb_key"] = sb_key
                st.session_state["admin_pw"] = admin_pw
                st.session_state["authed"] = True
                if save:
                    _CREDS_FILE.write_text(json.dumps({"sb_url": sb_url, "sb_key": sb_key, "admin_pw": admin_pw}))
                elif _CREDS_FILE.exists():
                    _CREDS_FILE.unlink()
                st.rerun()
            else:
                st.error("Wrong password")
        st.stop()

_BASE = st.session_state.get("sb_url", "").rstrip("/")
_TOKEN = st.session_state.get("sb_key", "")

# ─── Sidebar / refresh ──────────────────────────────────────────────────────

with st.sidebar:
    st.markdown("**Relativity Admin**")
    st.caption(f"URL: `{_BASE[:40]}...`" if len(_BASE) > 40 else f"URL: `{_BASE}`")
    if st.button("🔄  Refresh data", use_container_width=True):
        st.cache_data.clear()
    if st.button("Logout", use_container_width=True):
        for k in ("authed", "sb_url", "sb_key", "admin_pw"):
            st.session_state.pop(k, None)
        st.rerun()
    st.divider()
    st.caption("Data is cached for 30 s. Click Refresh to force.")

# ─── Load data ───────────────────────────────────────────────────────────────

with st.spinner("Loading data…"):
    users = auth_users()
    runs = rest("analysis_runs?select=user_id,symbol,share_name,agent_name,model,source,status,web_search,duration,total_score,created_at,error&limit=5000")
    runs = sorted(runs, key=lambda r: r.get("created_at", ""), reverse=True)  # ponytail: no DB index on created_at; sort locally
    settings = rest("user_settings?select=user_id,llm_keys_encrypted")
    agents = rest("agents?select=user_id,name,created_at")
    pulls = rest("stock_pulls?select=user_id,symbol,status,records,last_pulled_at,created_at&limit=2000")
    usage = rest("api_usage?select=day,provider,key_ref,model_id,requests,tokens_in,tokens_out,failures&limit=2000")

settings_map = {s["user_id"]: s for s in settings}
LLM_PROVS = {"openai", "google", "anthropic", "groq", "cerebras", "openrouter"}


def has_llm(uid: str) -> bool:
    s = settings_map.get(uid, {})
    keys = s.get("llm_keys_encrypted") or {}
    return any(keys.get(p) for p in LLM_PROVS)


def has_tavily(uid: str) -> bool:
    s = settings_map.get(uid, {})
    keys = s.get("llm_keys_encrypted") or {}
    return bool(keys.get("tavily"))


def email(uid: str) -> str:
    for u in users:
        if u["id"] == uid:
            return u.get("email", uid[:8])
    return uid[:8]


# ─── Tabs ────────────────────────────────────────────────────────────────────

t_overview, t_users, t_analytics, t_usage = st.tabs(["Overview", "Users", "Analytics", "Usage"])

# ═══════════════════════════════════════════════════════════════════════════════
# TAB: Overview
# ═══════════════════════════════════════════════════════════════════════════════
with t_overview:
    total_users = len(users)
    llm_users = sum(1 for u in users if has_llm(u["id"]))
    tavily_users = sum(1 for u in users if has_tavily(u["id"]))
    total_runs = len(runs)
    completed = sum(1 for r in runs if r.get("status") == "COMPLETED")
    failed = sum(1 for r in runs if r.get("status") == "FAILED")
    import datetime as _dt
    week_ago = (_dt.date.today() - _dt.timedelta(days=7)).isoformat()
    active_7d = len({r["user_id"] for r in runs if _day(r.get("created_at", "")) >= week_ago})

    c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
    c1.metric("Users", total_users)
    c2.metric("LLM keys", llm_users)
    c3.metric("Tavily", tavily_users)
    c4.metric("Runs", total_runs)
    c5.metric("Completed", completed)
    c6.metric("Failed", failed)
    c7.metric("Active (7d)", active_7d)

    st.subheader("New signups per day")
    st.bar_chart(_count_by_day(users, "created_at"), x="date", y="count", height=220, color="#6366f1")

    st.subheader("Analysis runs per day")
    st.bar_chart(_count_by_day(runs, "created_at"), x="date", y="count", height=220, color="#6366f1")

    st.subheader("LLM key adoption over time")
    import datetime as _dt
    today = _dt.date.today()
    dates = [(today - _dt.timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    sorted_users = sorted(users, key=lambda u: u.get("created_at", ""))
    cum_total, cum_llm, adoption = 0, 0, []
    by_date = {}
    for u in sorted_users:
        d = _day(u.get("created_at", ""))
        by_date.setdefault(d, []).append(u)
    for d in dates:
        for u in by_date.get(d, []):
            cum_total += 1
            if has_llm(u["id"]):
                cum_llm += 1
        pct = round(cum_llm / cum_total * 100) if cum_total else 0
        adoption.append({"date": d, "% with LLM keys": pct})
    st.line_chart(pd.DataFrame(adoption), x="date", y="% with LLM keys", height=220, color="#4ade80")

# ═══════════════════════════════════════════════════════════════════════════════
# TAB: Users
# ═══════════════════════════════════════════════════════════════════════════════
with t_users:
    from collections import Counter
    runs_count = Counter(r["user_id"] for r in runs)
    agents_count = Counter(a["user_id"] for a in agents)

    rows = []
    for u in users:
        uid = u["id"]
        rows.append({
            "email": u.get("email", uid[:12]),
            "signed up": _day(u.get("created_at", "")),
            "last seen": _day(u.get("last_sign_in_at", "")) if u.get("last_sign_in_at") else "",
            "runs": runs_count.get(uid, 0),
            "agents": agents_count.get(uid, 0),
            "LLM": "yes" if has_llm(uid) else "",
            "Tavily": "yes" if has_tavily(uid) else "",
            "_id": uid,
        })

    df = pd.DataFrame(rows).sort_values("runs", ascending=False)
    st.dataframe(
        df.drop(columns=["_id"]),
        use_container_width=True,
        height=min(500, 36 + len(df) * 34),
        hide_index=True,
    )

    st.subheader("User detail")
    emails = [u.get("email", u["id"][:12]) for u in users]
    pick = st.selectbox("Select user", emails, index=0)
    uid = None
    for u in users:
        if u.get("email", u["id"][:12]) == pick:
            uid = u["id"]
            uinfo = u
            break
    if uid:
        c1, c2, c3, c4 = st.columns(4)
        my_runs = [r for r in runs if r["user_id"] == uid]
        c1.metric("Total runs", len(my_runs))
        c2.metric("Agents", agents_count.get(uid, 0))
        c3.metric("LLM keys", "yes" if has_llm(uid) else "no")
        c4.metric("Tavily key", "yes" if has_tavily(uid) else "no")

        st.caption(f"Created: {uinfo.get('created_at', '')[:19]}  ·  Last sign-in: {(uinfo.get('last_sign_in_at') or 'never')[:19]}")

        st.markdown("**Runs per day**")
        st.bar_chart(_count_by_day(my_runs, "created_at"), x="date", y="count", height=180, color="#f472b6")

        st.markdown("**Most analysed stocks**")
        st.dataframe(_top_n(my_runs, "symbol", 10), use_container_width=True, hide_index=True)

        st.markdown("**Models used**")
        st.dataframe(_top_n(my_runs, "model", 8), use_container_width=True, hide_index=True)

        st.markdown("**Recent runs**")
        recent = pd.DataFrame([{
            "symbol": r.get("symbol", ""),
            "model": r.get("model", ""),
            "status": r.get("status", ""),
            "duration": f"{r.get('duration', 0):.0f}s" if r.get("duration") else "",
            "date": _day(r.get("created_at", "")),
        } for r in my_runs[:20]])
        st.dataframe(recent, use_container_width=True, hide_index=True)

# ═══════════════════════════════════════════════════════════════════════════════
# TAB: Usage (api_usage — server key farm + user keys)
# ═══════════════════════════════════════════════════════════════════════════════
with t_usage:
    if not usage:
        st.info("No usage recorded yet. It appears once LLM calls start flowing.")
    else:
        u_df = pd.DataFrame(usage)
        key_label = u_df["provider"] + " · " + u_df["key_ref"]

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Requests", int(u_df["requests"].sum()))
        c2.metric("Tokens in", int(u_df["tokens_in"].sum()))
        c3.metric("Tokens out", int(u_df["tokens_out"].sum()))
        c4.metric("Failures", int(u_df["failures"].sum()))

        st.subheader("Requests per day")
        by_day = u_df.groupby("day", as_index=False)["requests"].sum()
        st.bar_chart(by_day, x="day", y="requests", height=220, color="#6366f1")

        c5, c6 = st.columns(2)
        with c5:
            st.subheader("Requests per key")
            by_key = u_df.groupby(key_label, as_index=False)["requests"].sum().sort_values("requests", ascending=False)
            st.bar_chart(by_key, x=key_label.name, y="requests", height=300, color="#f472b6")
        with c6:
            st.subheader("Requests per model")
            by_model = u_df.groupby("model_id", as_index=False)["requests"].sum().sort_values("requests", ascending=False)
            st.bar_chart(by_model, x="model_id", y="requests", height=300, color="#4ade80")

        st.subheader("Token usage per provider (in / out)")
        by_prov = u_df.groupby("provider", as_index=False)[["tokens_in", "tokens_out"]].sum()
        st.dataframe(by_prov, use_container_width=True, hide_index=True)

        st.subheader("Failures per provider")
        by_fail = u_df.groupby("provider", as_index=False)[["failures"]].sum()
        st.dataframe(by_fail, use_container_width=True, hide_index=True)

# ═══════════════════════════════════════════════════════════════════════════════
# TAB: Analytics
# ═══════════════════════════════════════════════════════════════════════════════
with t_analytics:
    c1, c2 = st.columns(2)
    with c1:
        st.subheader("Most analysed stocks")
        st.bar_chart(_top_n(runs, "symbol", 15), x="name", y="count", height=320, color="#6366f1")
    with c2:
        st.subheader("Most popular LLMs")
        st.bar_chart(_top_n(runs, "model", 15), x="name", y="count", height=320, color="#f472b6")

    c3, c4 = st.columns(2)
    with c3:
        st.subheader("Stock source split (NSE / SEC)")
        from collections import Counter
        src = Counter(r.get("source") or "none" for r in runs)
        src_df = pd.DataFrame({"name": list(src.keys()), "count": list(src.values())})
        st.dataframe(src_df, use_container_width=True, hide_index=True)
    with c4:
        st.subheader("Run status breakdown")
        st_obj = Counter(r.get("status", "") for r in runs)
        st_df = pd.DataFrame({"status": list(st_obj.keys()), "count": list(st_obj.values())})
        st.dataframe(st_df, use_container_width=True, hide_index=True)

    st.subheader("Overall runs per user")
    rc = Counter(r["user_id"] for r in runs)
    top_users = rc.most_common(20)
    ru_df = pd.DataFrame({"user": [email(uid) for uid, _ in top_users], "count": [c for _, c in top_users]})
    st.bar_chart(ru_df, x="user", y="count", height=260, color="#facc15")

    st.subheader("Runs per user per day (top 5 users)")
    import datetime as _dt
    today = _dt.date.today()
    dates = [(today - _dt.timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    top5_uids = [uid for uid, _ in rc.most_common(5)]
    stacked = []
    for d in dates:
        row = {"date": d}
        for uid in top5_uids:
            row[email(uid).split("@")[0]] = sum(1 for r in runs if r["user_id"] == uid and _day(r.get("created_at", "")) == d)
        stacked.append(row)
    st.area_chart(pd.DataFrame(stacked), x="date", height=260)

    st.subheader("Average analysis duration by model (seconds)")
    dur: dict[str, list[float]] = {}
    for r in runs:
        if r.get("duration") and r["duration"] > 0:
            dur.setdefault(r["model"], []).append(r["duration"])
    dur_rows = sorted(
        [{"model": m, "avg_sec": round(sum(v) / len(v), 1)} for m, v in dur.items()],
        key=lambda x: -x["avg_sec"],
    )[:12]
    st.dataframe(pd.DataFrame(dur_rows), use_container_width=True, hide_index=True)

    c5, c6 = st.columns(2)
    with c5:
        st.subheader("Web search usage")
        ws = sum(1 for r in runs if r.get("web_search"))
        st.metric("Runs with web search enabled", ws)
        st.metric("Total runs", len(runs))
    with c6:
        st.subheader("Peak usage hours")
        hr = Counter()
        for r in runs:
            try:
                hr[pd.Timestamp(r["created_at"]).hour] += 1
            except Exception:
                pass
        hr_df = pd.DataFrame({"hour": [f"{h}:00" for h in range(24)], "count": [hr.get(h, 0) for h in range(24)]})
        st.bar_chart(hr_df, x="hour", y="count", height=200, color="#38bdf8")
