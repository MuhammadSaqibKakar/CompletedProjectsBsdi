import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileSliders,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

function navigate(to) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "instant" });
}
function Link({ to, children, onClick, ...props }) {
  return (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button
        )
          return;
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Something went wrong. Please try again."),
      { status: response.status },
    );
  return data;
}
function useLoad(url, revision = 0) {
  const [result, setResult] = useState({ key: "", data: null, error: "" });
  const key = `${url}:${revision}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api(url, { signal: controller.signal })
      .then((data) => setResult({ key, data, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError")
          setResult({ key, data: null, error: error.message });
      });
    return () => controller.abort();
  }, [url, key]);
  return result.key === key
    ? { ...result, loading: false }
    : { data: null, error: "", loading: Boolean(url) };
}
function Loading({ cards = false }) {
  return cards ? (
    <div className="district-grid" aria-label="Loading districts">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="district-card skeleton" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  ) : (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={24} /> Loading…
    </div>
  );
}
function ErrorState({ message, retry }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
const date = (value) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
const size = (value) =>
  value < 1048576
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1048576).toFixed(1)} MB`;

export default function App() {
  const [today] = useState(() => Date.now());
  const [pathname, setPathname] = useState(window.location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const catalog = useLoad("/api/districts", revision);
  const admin = pathname.replace(/\/$/, "") === "/admin";
  const districtId = pathname.match(/^\/district\/([a-z0-9-]+)\/?$/)?.[1];
  const selectedDistrict = catalog.data?.districts.find(
    (district) => district.id === districtId,
  );
  useEffect(() => {
    const update = () => {
      setPathname(window.location.pathname);
      setMenuOpen(false);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    document.title = `${admin ? "Administration" : selectedDistrict?.name || "Completed Projects"} | BSDI`;
  }, [admin, selectedDistrict?.name]);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-emblem">
            <CheckCheck size={26} strokeWidth={2.2} />
          </span>
          <span>
            <strong>BSDI</strong>
            <small>COMPLETED PROJECTS</small>
          </span>
        </Link>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <Link
            to="/"
            className={`nav-item ${!admin && !districtId ? "active" : ""}`}
          >
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
            <ChevronRight size={15} />
          </Link>
          <Link to="/" className={`nav-item ${districtId ? "active" : ""}`}>
            <MapPin size={19} />
            <span>District directory</span>
            <span className="nav-count">39</span>
          </Link>
          {admin && (
            <Link to="/admin" className="nav-item active">
              <ShieldCheck size={19} />
              <span>Administration</span>
            </Link>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="status-light" /> Completed projects only
          <p>
            A dedicated space for the work
            <br />
            delivered across Balochistan.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-line" />
          <p>
            Balochistan Special
            <br />
            Development Initiative
          </p>
          <span>PROGRESS, PRESENTED.</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb-home">Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {admin
                ? "Administration"
                : districtId
                  ? selectedDistrict?.name || "District"
                  : "Dashboard"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="today">{date(today)}</span>
            <span className="topbar-divider" />
            <span className="profile-mark" aria-label="BSDI">
              B
            </span>
          </div>
        </header>
        <main className="page-content" id="main-content">
          {admin ? (
            <AdminPage
              catalog={catalog}
              onChange={() => setRevision((value) => value + 1)}
            />
          ) : districtId ? (
            <DistrictPage key={districtId} id={districtId} />
          ) : (
            <Dashboard
              catalog={catalog}
              retry={() => setRevision((value) => value + 1)}
            />
          )}
          <footer className="page-footer">
            <span>© {new Date(today).getFullYear()} BSDI</span>
            <span>Completed work. Lasting impact.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Dashboard({ catalog, retry }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const districts = catalog.data?.districts || [];
  const visible = districts.filter(
    (district) =>
      district.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter !== "published" || district.presentationCount > 0),
  );
  const published = districts.filter(
    (district) => district.presentationCount > 0,
  ).length;
  return (
    <>
      <section className="welcome-hero enter">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-dot" /> THE COMPLETED PROJECTS PORTAL
          </span>
          <h1>
            Good to see you.
            <br />
            <span>Explore what’s complete.</span>
          </h1>
          <p>
            This dashboard brings together completed BSDI projects.
            <br className="desktop-break" /> Select a district to view and
            download its presentations.
          </p>
          <a className="hero-link" href="#districts">
            Explore the districts <ArrowRight size={17} />
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-dot dot-one" />
          <div className="art-dot dot-two" />
          <div className="art-card art-back" />
          <div className="art-card art-front">
            <span className="art-mini">BSDI / PROJECTS</span>
            <span className="art-check">
              <Check size={37} strokeWidth={2.3} />
            </span>
            <strong>Work delivered.</strong>
            <span className="art-rule" />
            <span className="art-rule short" />
          </div>
          <span className="art-badge">
            <CircleCheck size={16} /> Completed
          </span>
        </div>
      </section>
      <section className="summary-row enter" aria-label="Portal overview">
        <div className="summary-item">
          <span className="summary-icon sage">
            <MapPin size={21} />
          </span>
          <div>
            <strong>39</strong>
            <span>Districts to explore</span>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon peach">
            <FileSliders size={21} />
          </span>
          <div>
            <strong>
              {catalog.loading
                ? "—"
                : (catalog.data?.totalPresentations ?? "—")}
            </strong>
            <span>Published presentations</span>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon sand">
            <CircleCheck size={21} />
          </span>
          <div>
            <strong>{catalog.loading ? "—" : published}</strong>
            <span>Districts with presentations</span>
          </div>
        </div>
        <div className="summary-description">
          <Sparkles size={17} />
          <span>
            Your district.
            <br />
            <strong>Its completed story.</strong>
          </span>
        </div>
      </section>
      <section className="directory-section" id="districts">
        <div className="section-heading">
          <div>
            <span className="eyebrow muted">EXPLORE BY LOCATION</span>
            <h2>
              District directory <span className="count-pill">39</span>
            </h2>
            <p>Every district has a place. Find the one you’re looking for.</p>
          </div>
          <div className="directory-tools">
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="Search districts"
                placeholder="Search a district…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  className="clear-button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <label className="select-field">
              <select
                aria-label="Filter district availability"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">All districts</option>
                <option value="published">With presentations</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
        </div>
        {catalog.loading ? (
          <Loading cards />
        ) : catalog.error ? (
          <ErrorState message={catalog.error} retry={retry} />
        ) : visible.length ? (
          <div className="district-grid">
            {visible.map((district, index) => (
              <Link
                to={`/district/${district.id}`}
                className="district-card"
                key={district.id}
                style={{ "--order": Math.min(index, 11) }}
              >
                <div className="district-card-top">
                  <span
                    className={`district-icon ${district.presentationCount ? "has-content" : ""}`}
                  >
                    <MapPin size={22} strokeWidth={1.7} />
                  </span>
                  <span className="district-arrow">
                    <ArrowRight size={18} />
                  </span>
                </div>
                <span className="district-region">BALOCHISTAN</span>
                <h3>{district.name}</h3>
                <div className="district-card-bottom">
                  {district.presentationCount ? (
                    <span className="published-label">
                      <span />
                      {district.presentationCount} presentation
                      {district.presentationCount === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="pending-label">
                      <span />
                      Awaiting presentation
                    </span>
                  )}
                  <FileSliders size={15} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <Search size={27} />
            <h3>No matching districts</h3>
            <p>Try a different name or show all districts.</p>
            <button
              className="button secondary"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Show all districts
            </button>
          </div>
        )}
        {!catalog.loading && !catalog.error && (
          <p className="results-caption">
            Showing {visible.length} of 39 districts
          </p>
        )}
      </section>
    </>
  );
}

function DistrictPage({ id }) {
  const [revision, setRevision] = useState(0);
  const detail = useLoad(`/api/districts/${id}`, revision);
  const [chosenId, setChosenId] = useState("");
  const selected =
    detail.data?.presentations.find((item) => item.id === chosenId) ||
    detail.data?.presentations[0];
  return (
    <>
      <Link to="/" className="back-link">
        <ArrowLeft size={17} /> Back to districts
      </Link>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorState
          message={detail.error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : (
        <>
          <div className="district-page-heading enter">
            <div>
              <span className="eyebrow muted">
                <MapPin size={14} /> BALOCHISTAN · DISTRICT
              </span>
              <h1>{detail.data.district.name}</h1>
              <p>
                Explore the district’s completed projects through its
                presentations.
              </p>
            </div>
            <span className="district-heading-badge">
              <FileSliders size={17} />
              {detail.data.presentations.length} presentation
              {detail.data.presentations.length === 1 ? "" : "s"}
            </span>
          </div>
          {selected ? (
            <div className="presentation-layout enter">
              <aside className="presentation-list">
                <div className="list-title">
                  District presentations
                  <span>{detail.data.presentations.length}</span>
                </div>
                {detail.data.presentations.map((item) => (
                  <button
                    className={`presentation-choice ${selected.id === item.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setChosenId(item.id)}
                  >
                    <FileSliders size={21} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {date(item.uploadedAt)} · {size(item.size)}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </aside>
              <section className="presentation-panel">
                <div className="presentation-panel-header">
                  <div>
                    <span className="eyebrow muted">COMPLETED PROJECTS</span>
                    <h2>{selected.title}</h2>
                    <p>
                      {selected.slideCount} slides · {size(selected.size)} ·
                      Added {date(selected.uploadedAt)}
                    </p>
                  </div>
                  <a
                    className="button primary"
                    href={selected.downloadUrl}
                    download
                  >
                    <ArrowDownToLine size={17} />
                    Download PPTX
                  </a>
                </div>
                <iframe
                  key={selected.id}
                  className="slide-frame"
                  src={selected.viewUrl}
                  title={`${selected.title} presentation viewer`}
                  sandbox="allow-scripts allow-downloads"
                  allowFullScreen
                />
                <div className="presentation-footnote">
                  <ShieldCheck size={15} />
                  View the slides here, or download the original PowerPoint.
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-state district-empty enter">
              <span className="empty-illustration">
                <FolderOpen size={42} strokeWidth={1.5} />
                <span>
                  <FileSliders size={18} />
                </span>
              </span>
              <span className="eyebrow muted">A SPACE FOR COMPLETED WORK</span>
              <h2>The presentation is on its way.</h2>
              <p>
                No presentations have been published for{" "}
                {detail.data.district.name} yet.
                <br />
                They’ll appear here as soon as the administrator uploads them.
              </p>
              <Link to="/" className="button secondary">
                Explore other districts <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}

function AdminPage({ catalog, onChange }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api("/api/admin/session", { signal: controller.signal })
      .then(setSession)
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <ErrorState message={error} retry={() => window.location.reload()} />
    );
  if (!session) return <Loading />;
  if (!session.authenticated) return <LoginForm onLogin={setSession} />;
  return (
    <AdminWorkspace
      catalog={catalog}
      session={session}
      onChange={onChange}
      onSignedOut={() => setSession({ authenticated: false })}
    />
  );
}

function LoginForm({ onLogin }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      onLogin(session);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout enter">
      <div className="login-intro">
        <span className="eyebrow">
          <ShieldCheck size={16} /> ADMINISTRATION
        </span>
        <h1>
          A little behind <br />
          the scenes.
        </h1>
        <p>
          Manage the presentations that tell each district’s completed story.
        </p>
        <div className="login-feature">
          <span>
            <FileUp size={20} />
          </span>
          <div>
            <strong>Publish a presentation</strong>
            <p>Choose a district and add its PowerPoint.</p>
          </div>
        </div>
        <div className="login-feature">
          <span>
            <Trash2 size={20} />
          </span>
          <div>
            <strong>Keep the directory current</strong>
            <p>Remove presentations when they’re no longer needed.</p>
          </div>
        </div>
        <Link to="/" className="back-link">
          <ArrowLeft size={16} /> Back to the dashboard
        </Link>
      </div>
      <section className="login-card">
        <span className="login-lock">
          <LockKeyhole size={28} strokeWidth={1.6} />
        </span>
        <h2>Administrator sign in</h2>
        <p>Enter your password to manage district presentations.</p>
        <form onSubmit={signIn}>
          <label className="field-label" htmlFor="admin-password">
            Admin password
          </label>
          <input
            className="text-input"
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            placeholder="Enter your password"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full-width"
            disabled={busy || !password}
          >
            {busy ? (
              <>
                <LoaderCircle size={18} className="spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in securely
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="login-security">
          <ShieldCheck size={15} />
          Private access for presentation management
        </div>
      </section>
    </div>
  );
}

function AdminWorkspace({ catalog, session, onChange, onSignedOut }) {
  const [chosenDistrict, setChosenDistrict] = useState("");
  const districtId = chosenDistrict || catalog.data?.districts[0]?.id;
  const [revision, setRevision] = useState(0);
  const detail = useLoad(
    districtId ? `/api/districts/${districtId}` : null,
    revision,
  );
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => () => uploadRef.current?.abort(), []);
  const csrfHeaders = { "X-CSRF-Token": session.csrfToken };
  function refresh() {
    setRevision((value) => value + 1);
    onChange();
  }
  function failure(error) {
    if (error.status === 401) onSignedOut();
    else setError(error.message);
  }
  function chooseFile(files) {
    setError("");
    setMessage("");
    if (!files?.length) return;
    if (files.length !== 1 || !/\.pptx$/i.test(files[0].name)) {
      setError(
        "Choose one PowerPoint .pptx file. Save older .ppt files as .pptx first.",
      );
      return;
    }
    if (files[0].size > 200 * 1024 * 1024) {
      setError("Choose a presentation of 200 MB or smaller.");
      return;
    }
    setFile(files[0]);
  }
  async function signOut() {
    try {
      await api("/api/admin/logout", { method: "POST", headers: csrfHeaders });
      onSignedOut();
    } catch (error) {
      failure(error);
    }
  }
  async function upload(event) {
    event.preventDefault();
    if (!file || !districtId || busy) return;
    setBusy(true);
    setProgress(0);
    setError("");
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRef.current = xhr;
        xhr.open("POST", `/api/admin/districts/${districtId}/presentations`);
        xhr.withCredentials = true;
        xhr.setRequestHeader("X-CSRF-Token", session.csrfToken);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let data = {};
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            /* The server may return a hosting error page. */
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else
            reject(
              Object.assign(
                new Error(
                  data.error ||
                    "The upload could not be completed. Please try again.",
                ),
                { status: xhr.status },
              ),
            );
        };
        xhr.onerror = () =>
          reject(
            new Error("The connection was interrupted. Please try again."),
          );
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(form);
      });
      setFile(null);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setMessage(
        "Presentation published. It is now available to view and download.",
      );
      refresh();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
      uploadRef.current = null;
    }
  }
  async function removePresentation() {
    if (!deleteItem || deleting) return;
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/admin/presentations/${deleteItem.id}`, {
        method: "DELETE",
        headers: csrfHeaders,
      });
      setDeleteItem(null);
      setMessage("Presentation deleted.");
      refresh();
    } catch (error) {
      setDeleteItem(null);
      failure(error);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="admin-heading enter">
        <div>
          <span className="eyebrow muted">
            <ShieldCheck size={15} /> ADMINISTRATION
          </span>
          <h1>Presentation manager</h1>
          <p>A simple home for each district’s completed work.</p>
        </div>
        <button
          className="button secondary"
          onClick={signOut}
          disabled={busy || deleting}
        >
          <LogOut size={17} />
          Sign out
        </button>
      </div>
      <div className="admin-district-bar">
        <div>
          <span className="summary-icon sage">
            <MapPin size={21} />
          </span>
          <div>
            <strong>Choose a district</strong>
            <p>Uploads will appear on this district’s public page.</p>
          </div>
        </div>
        <label className="select-field district-select">
          <select
            aria-label="District to manage"
            value={districtId || ""}
            disabled={busy || deleting || catalog.loading}
            onChange={(event) => {
              setChosenDistrict(event.target.value);
              setMessage("");
              setError("");
            }}
          >
            {(catalog.data?.districts || []).map((district) => (
              <option key={district.id} value={district.id}>
                {district.name}
              </option>
            ))}
          </select>
          <ChevronDown size={17} />
        </label>
      </div>
      {catalog.error && <ErrorState message={catalog.error} />}
      {error && (
        <div className="notice error" role="alert">
          <X size={18} />
          <span>{error}</span>
          <button
            className="clear-button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          <CircleCheck size={19} />
          <span>{message}</span>
          <button
            className="clear-button"
            onClick={() => setMessage("")}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="admin-columns">
        <section className="admin-panel upload-panel">
          <div className="panel-heading">
            <span className="panel-icon">
              <FileUp size={20} />
            </span>
            <div>
              <h2>Add a presentation</h2>
              <p>Ready to share some completed work?</p>
            </div>
          </div>
          <form onSubmit={upload}>
            <label
              className={`upload-dropzone ${dragging ? "dragging" : ""} ${busy ? "disabled" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) chooseFile(event.dataTransfer.files);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                aria-label="Choose a PowerPoint presentation"
                disabled={busy}
                onChange={(event) => chooseFile(event.target.files)}
              />
              <span className="upload-cloud">
                <FileUp size={29} strokeWidth={1.5} />
              </span>
              <strong>
                {file
                  ? "Choose a different presentation"
                  : "Drop your presentation here"}
              </strong>
              <span>
                or <b>browse files</b>
              </span>
              <small>PowerPoint (.pptx) · Up to 200 MB · 500 slides</small>
            </label>
            {file && (
              <div className="selected-file">
                <FileSliders size={25} />
                <div>
                  <strong>{file.name}</strong>
                  <small>{size(file.size)}</small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove selected file"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            <label className="field-label" htmlFor="presentation-title">
              Presentation title <span>Optional</span>
            </label>
            <input
              className="text-input"
              id="presentation-title"
              value={title}
              maxLength={160}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Use the file name, or add a title"
            />
            {busy && (
              <div className="upload-progress" role="status">
                <div>
                  <span>
                    {progress === 100
                      ? "Checking and publishing…"
                      : "Uploading presentation…"}
                  </span>
                  <strong>{progress}%</strong>
                </div>
                <progress max="100" value={progress} />
              </div>
            )}
            <button
              className="button primary full-width"
              disabled={!file || busy || !districtId}
            >
              {busy ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <FileUp size={18} />
                  Publish presentation
                </>
              )}
            </button>
            <p className="upload-help">
              Use a self-contained .pptx with embedded images. Save older .ppt
              files as .pptx before uploading.
            </p>
          </form>
        </section>
        <section className="admin-panel managed-panel">
          <div className="panel-heading">
            <span className="panel-icon peach">
              <FolderOpen size={20} />
            </span>
            <div>
              <h2>{detail.data?.district.name || "District"} presentations</h2>
              <p>
                {detail.data?.presentations.length ?? 0} published to this
                district
              </p>
            </div>
            {districtId && (
              <Link
                className="icon-button"
                to={`/district/${districtId}`}
                aria-label="View district page"
              >
                <ArrowRight size={19} />
              </Link>
            )}
          </div>
          {detail.loading ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState message={detail.error} retry={refresh} />
          ) : detail.data?.presentations.length ? (
            <div className="managed-list">
              {detail.data.presentations.map((item) => (
                <div className="managed-item" key={item.id}>
                  <span className="managed-file-icon">
                    <FileSliders size={23} />
                  </span>
                  <div className="managed-item-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.slideCount} slides · {size(item.size)}
                    </span>
                    <small>Added {date(item.uploadedAt)}</small>
                    <a href={item.downloadUrl} download>
                      Download original <ArrowDownToLine size={13} />
                    </a>
                  </div>
                  <button
                    className="delete-button icon-button"
                    disabled={busy || deleting}
                    onClick={() => setDeleteItem(item)}
                    aria-label={`Delete ${item.title}`}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact admin-empty">
              <FolderOpen size={35} strokeWidth={1.4} />
              <h3>A fresh start for this district.</h3>
              <p>
                Upload a presentation to make it available
                <br />
                on the district’s public page.
              </p>
            </div>
          )}
          <div className="managed-note">
            <CircleCheck size={16} /> Published presentations can be viewed and
            downloaded by everyone.
          </div>
        </section>
      </div>
      {deleteItem && (
        <DeleteDialog
          item={deleteItem}
          busy={deleting}
          onClose={() => setDeleteItem(null)}
          onConfirm={removePresentation}
        />
      )}
    </>
  );
}

function DeleteDialog({ item, busy, onClose, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      className="delete-dialog"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="delete-title"
      aria-describedby="delete-description"
    >
      <span className="delete-dialog-icon">
        <Trash2 size={24} />
      </span>
      <h2 id="delete-title">Delete this presentation?</h2>
      <p id="delete-description">
        <strong>{item.title}</strong> will be removed from the district page.
        You can upload the original again later.
      </p>
      <div className="dialog-actions">
        <button
          className="button secondary"
          onClick={onClose}
          disabled={busy}
          autoFocus
        >
          Keep presentation
        </button>
        <button className="button danger" onClick={onConfirm} disabled={busy}>
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Trash2 size={17} />
          )}
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </dialog>
  );
}
