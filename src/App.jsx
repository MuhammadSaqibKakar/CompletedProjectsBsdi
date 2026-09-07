import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
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
  Trash2,
  X,
} from "lucide-react";

function navigate(to) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const section = to.split("#")[1];
  if (section)
    requestAnimationFrame(() =>
      document.getElementById(section)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      }),
    );
  else window.scrollTo({ top: 0, behavior: "instant" });
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
  const sidebarRef = useRef(null);
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
    document.title = admin
      ? "Administration | BSDI"
      : selectedDistrict?.name
        ? `${selectedDistrict.name} | BSDI Completed Projects`
        : "BSDI Completed Projects Dashboard";
  }, [admin, selectedDistrict?.name]);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 780px)");
    const closeOnDesktop = () => {
      if (!mobile.matches) setMenuOpen(false);
    };
    mobile.addEventListener("change", closeOnDesktop);
    return () => mobile.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    const sidebar = sidebarRef.current;
    const links = sidebar.querySelectorAll("a[href], button");
    // Wait for the drawer's visibility transition to begin before focusing it.
    let focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => links[0]?.focus());
    });
    const handleKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key !== "Tab") return;
      const first = links[0];
      const last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [menuOpen]);
  return (
    <div className={`app-shell ${districtId ? "district-view-shell" : ""}`}>
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
      <aside
        ref={sidebarRef}
        id="site-navigation"
        className={`sidebar ${menuOpen ? "is-open" : ""}`}
      >
        <Link to="/" className="brand">
          <span className="brand-emblem">
            <img
              className="brand-logo"
              src="/official-logo.svg"
              alt="BSDI emblem"
              width="64"
              height="64"
            />
          </span>
          <span>
            <strong>BSDI</strong>
            <small>COMPLETED PROJECTS</small>
          </span>
        </Link>
        <p className="nav-label">COMPLETED PROJECTS</p>
        <nav aria-label="Main navigation">
          <Link
            to="/"
            className={`nav-item ${!admin && !districtId ? "active" : ""}`}
          >
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
            <ChevronRight size={15} />
          </Link>
          <Link
            to="/#districts"
            className={`nav-item ${districtId ? "active" : ""}`}
          >
            <MapPin size={19} />
            <span>District directory</span>
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
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-line" />
          <p>
            Balochistan Special
            <br />
            Development Initiative
          </p>
          <span>Planning & Development Department</span>
        </div>
      </aside>
      <div className="main-shell" inert={menuOpen || undefined}>
        <button
          className="icon-button mobile-menu floating-menu"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
          aria-controls="site-navigation"
          aria-expanded={menuOpen}
        >
          <Menu size={21} />
        </button>
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
          {!districtId && (
            <footer className="page-footer">
              <span>© {new Date(today).getFullYear()} BSDI</span>
              <span>Completed work. Lasting impact.</span>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}

function Dashboard({ catalog, retry }) {
  const gridRef = useRef(null);
  const [revealedDistricts, setRevealedDistricts] = useState(
    () => new Set(),
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const districts = catalog.data?.districts || [];
  const visible = districts.filter(
    (district) =>
      district.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter !== "published" || district.presentationCount > 0),
  );
  const visibleKey = visible.map((district) => district.id).join(",");
  useEffect(() => {
    const grid = gridRef.current;
    if (
      !grid ||
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const cards = [...grid.querySelectorAll(".district-card")];
    grid.classList.add("reveal-ready");
    const markRevealed = (card) => {
      card.classList.add("is-revealed");
      const district = card.dataset.districtId;
      if (district)
        setRevealedDistricts((current) => {
          if (current.has(district)) return current;
          const next = new Set(current);
          next.add(district);
          return next;
        });
    };
    const revealVisible = () => {
      for (const card of cards) {
        if (card.classList.contains("is-revealed")) continue;
        const bounds = card.getBoundingClientRect();
        if (bounds.top < window.innerHeight + 30 && bounds.bottom > -30)
          markRevealed(card);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markRevealed(entry.target);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px 30px 0px" },
    );
    cards.forEach((card) => observer.observe(card));
    const fallback = window.setTimeout(revealVisible, 120);
    window.addEventListener("scroll", revealVisible, { passive: true });
    window.addEventListener("resize", revealVisible);
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("scroll", revealVisible);
      window.removeEventListener("resize", revealVisible);
      observer.disconnect();
      grid.classList.remove("reveal-ready");
    };
  }, [visibleKey, catalog.loading]);
  return (
    <>
      <section className="welcome-hero enter">
        <div className="hero-copy">
          <span className="eyebrow">
            BALOCHISTAN SPECIAL DEVELOPMENT INITIATIVE
          </span>
          <h1>
            <span className="hero-title-brand">BSDI</span>
            <span className="hero-title-main">Completed Projects</span>
            <small>Dashboard</small>
          </h1>
          <p>Completed projects, district by district.</p>
          <a className="hero-link" href="#districts">
            Explore districts <ArrowRight size={21} />
          </a>
        </div>
        <div className="hero-seal">
          <span className="seal-medallion">
            <img
              className="official-seal"
              src="/official-logo.svg"
              width="300"
              height="300"
              alt="Balochistan Special Development Initiative, Planning and Development Department"
              fetchPriority="high"
            />
          </span>
        </div>
      </section>
      <section className="directory-section" id="districts">
        <div className="section-heading">
          <div>
            <h2>Explore districts</h2>
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
          <div className="district-grid" ref={gridRef}>
            {visible.map((district, index) => (
              <Link
                to={`/district/${district.id}`}
                className={`district-card ${revealedDistricts.has(district.id) ? "is-revealed" : ""}`}
                key={district.id}
                data-district-id={district.id}
                style={{ "--order": Math.min(index, 7) }}
              >
                <span className="district-icon">
                  <MapPin size={24} strokeWidth={1.7} />
                </span>
                <h3>{district.name}</h3>
                <span className="district-arrow">
                  <ArrowRight size={19} />
                </span>
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
      </section>
    </>
  );
}

function DistrictPage({ id }) {
  const [revision, setRevision] = useState(0);
  const detail = useLoad(`/api/districts/${id}`, revision);
  const selected = detail.data?.presentations[0];
  const districtName = detail.data?.district.name;
  return (
    <section className="district-view">
      <div className="district-view-heading">
        <Link
          to="/#districts"
          className="icon-button district-back"
          aria-label="Back to districts"
        >
          <ArrowLeft size={22} />
        </Link>
        <h1>{districtName || "District"}</h1>
      </div>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorState
          message={detail.error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : selected?.available === false ? (
        <div className="empty-state district-empty missing-presentation enter">
          <FileSliders size={42} strokeWidth={1.5} />
          <h2>Presentation needs to be uploaded again</h2>
          <p>The saved PowerPoint file is currently unavailable.</p>
          <Link to="/#districts" className="button secondary">
            Explore districts <ArrowRight size={18} />
          </Link>
        </div>
      ) : selected ? (
        <iframe
          key={selected.id}
          className="slide-frame district-full-viewer"
          src={selected.viewUrl}
          title={`${districtName} presentation viewer`}
          sandbox="allow-scripts allow-downloads"
          allowFullScreen
        />
      ) : (
        <div className="empty-state district-empty enter">
          <FolderOpen size={42} strokeWidth={1.5} />
          <h2>No presentation yet</h2>
          <Link to="/#districts" className="button secondary">
            Explore districts <ArrowRight size={18} />
          </Link>
        </div>
      )}
    </section>
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
        <h1>District presentation management.</h1>
        <p>Publish and manage completed project presentations.</p>
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
  const hasPresentation = Boolean(detail.data?.presentations.length);
  const missingPresentation = detail.data?.presentations.find(
    (presentation) => presentation.available === false,
  );
  const uploadUnavailable =
    hasPresentation || detail.loading || Boolean(detail.error);
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
    if (uploadUnavailable) return;
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
    if (!file || !districtId || busy || uploadUnavailable) return;
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
          <p>One presentation per district.</p>
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
            <p>Select the district to manage.</p>
          </div>
        </div>
        <label className="select-field district-select">
          <select
            aria-label="District to manage"
            value={districtId || ""}
            disabled={busy || deleting || catalog.loading}
            onChange={(event) => {
              setChosenDistrict(event.target.value);
              setFile(null);
              setTitle("");
              if (fileRef.current) fileRef.current.value = "";
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
              <h2>Upload presentation</h2>
              <p>Upload to the selected district.</p>
            </div>
          </div>
          {hasPresentation ? (
            <div className="upload-occupied">
              {missingPresentation ? (
                <FileSliders size={32} />
              ) : (
                <CircleCheck size={32} />
              )}
              <h3>
                {missingPresentation
                  ? "PowerPoint file missing"
                  : "Presentation published"}
              </h3>
              <p>
                {missingPresentation
                  ? "Delete the missing record below, then upload the PowerPoint again."
                  : "Delete the current presentation before uploading a new one."}
              </p>
            </div>
          ) : (
            <form onSubmit={upload}>
              <label
                className={`upload-dropzone ${dragging ? "dragging" : ""} ${busy || uploadUnavailable ? "disabled" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy && !uploadUnavailable) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (!busy && !uploadUnavailable)
                    chooseFile(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  aria-label="Choose a PowerPoint presentation"
                  disabled={busy || uploadUnavailable}
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
                disabled={!file || busy || !districtId || uploadUnavailable}
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
          )}
        </section>
        <section className="admin-panel managed-panel">
          <div className="panel-heading">
            <span className="panel-icon peach">
              <FolderOpen size={20} />
            </span>
            <div>
              <h2>{detail.data?.district.name || "District"}</h2>
              <p>District presentation</p>
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
                    {item.available === false ? (
                      <strong className="managed-file-status">
                        File missing — upload again
                      </strong>
                    ) : (
                      <a href={item.downloadUrl} download>
                        Download original <ArrowDownToLine size={13} />
                      </a>
                    )}
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
              <h3>No presentations yet</h3>
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
