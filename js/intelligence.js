/*
====================================================
SECURITY INTELLIGENCE PAGE
====================================================

Independent page. Calls:

    /api/v1/intelligence/summary

====================================================
*/


/*
====================================================
CONFIGURATION
====================================================
*/

const INTELLIGENCE_API =
    "https://dailyreportgenbackend.adityakumarsahu108.workers.dev/api/v1/intelligence/summary";

// How often the "Updated X ago" label re-ticks without refetching data.
const RELATIVE_TIME_TICK_MS = 30000;


/*
====================================================
DOM HELPERS
====================================================
*/

function getElement(id) {
    return document.getElementById(id);
}


function escapeHTML(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


function formatNumber(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "0";
    }

    return number.toLocaleString();

}


function formatPercentage(value, digits = 1) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "0%";
    }

    return `${number.toFixed(digits)}%`;

}


function formatDate(value) {

    if (!value) {
        return "\u2014";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return escapeHTML(value);
    }

    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });

}


// Report dates arrive as compact "YYYYMMDD" strings rather than ISO.
function formatReportDate(value) {

    if (!value) {
        return "\u2014";
    }

    const raw = String(value);

    if (/^\d{8}$/.test(raw)) {

        const year = raw.slice(0, 4);
        const month = raw.slice(4, 6);
        const day = raw.slice(6, 8);

        const date = new Date(`${year}-${month}-${day}T00:00:00`);

        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric"
            });
        }

    }

    return formatDate(value);

}


function relativeTime(value) {

    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.round(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 minute ago";
    if (diffMin < 60) return `${diffMin} minutes ago`;

    const diffHr = Math.round(diffMin / 60);

    if (diffHr === 1) return "1 hour ago";
    if (diffHr < 24) return `${diffHr} hours ago`;

    const diffDay = Math.round(diffHr / 24);

    return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;

}


function severityToTone(severity) {

    const s = String(severity || "").toLowerCase();

    if (s === "critical" || s === "high") return "red";
    if (s === "medium") return "amber";
    if (s === "low") return "green";

    return "grey";

}


function statusToTone(status) {

    const s = String(status || "").toLowerCase();

    if (s === "open" || s === "active" || s === "investigating") return "amber";
    if (s === "riskaccepted") return "blue";
    if (s === "resolved" || s === "closed") return "green";

    return "grey";

}


function priorityClass(priority) {

    const p = String(priority || "low").toLowerCase();

    if (p === "critical" || p === "high") return "priority-high";
    if (p === "medium") return "priority-medium";

    return "priority-low";

}


/*
====================================================
CHART COLOR TOKENS
====================================================
Chart.js can't read CSS custom properties directly for
canvas fills, so the same palette used across the page
(:root tokens in index.html) is mirrored here as plain
hex/rgba values. Keep these in sync if the CSS palette
ever changes.
====================================================
*/

const CHART_COLORS = {
    red: "#ef5350",
    amber: "#e8a63c",
    green: "#3fb968",
    blue: "#5b9df9",
    grey: "#8d99aa",
    textPrimary: "#eaf0f6",
    textSecondary: "#8d99aa",
    textTertiary: "#56616f",
    gridLine: "rgba(141, 153, 170, 0.10)",
    panelBg: "#1a222c"
};

function chartToneColor(tone) {
    return CHART_COLORS[tone] || CHART_COLORS.grey;
}

// Keeps Chart.js's default font in step with the rest of the page.
if (window.Chart) {
    Chart.defaults.font.family =
        "'IBM Plex Mono', ui-monospace, monospace";
    Chart.defaults.color = CHART_COLORS.textSecondary;
}


/*
====================================================
PRESENTATION HELPERS
(purely cosmetic — do not touch data shape or logic)
====================================================
*/

// Returns an inline animation-delay so rows stagger in on render
// instead of popping in all at once. Pair with class="row-anim".
function rowDelay(index, stepMs = 40) {
    return `animation-delay:${index * stepMs}ms;`;
}

// After inserting bars/gauges with an inline target width, animate
// them from 0 -> target so the panel feels alive instead of static.
function animateFills(root) {

    if (!root) {
        return;
    }

    const fills = root.querySelectorAll(
        ".score-gauge-fill, .lifecycle-new, .lifecycle-carried, .bar-fill"
    );

    fills.forEach(el => {
        const target = el.style.width;
        if (!target) return;
        el.style.width = "0%";
        // Force reflow so the browser registers the 0% start state.
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        requestAnimationFrame(() => {
            el.style.width = target;
        });
    });

}


function emptyState(message, options = {}) {

    const icon = options.icon || "\u25CB";
    const showRetry = Boolean(options.retry);

    return `
        <div class="empty-state">
            <div class="empty-icon">${icon}</div>
            ${escapeHTML(message)}
            ${showRetry ? `<div style="margin-top:12px;"><button class="btn-refresh" style="display:inline-flex; padding:7px 12px; font-size:12px;" onclick="loadIntelligence()">Try again</button></div>` : ""}
        </div>
    `;

}


/*
====================================================
STATUS BANNER
====================================================
*/

function setStatus(message, type = "loading") {

    const status = getElement("status");

    if (!status) {
        return;
    }

    if (!message) {
        status.style.display = "none";
        return;
    }

    const showRetry = type === "error";

    status.innerHTML = `
        <span class="status-banner-text">${escapeHTML(message)}</span>
        ${showRetry ? `<button class="status-retry" type="button" onclick="loadIntelligence()">Retry</button>` : ""}
    `;
    status.className = `status-banner ${type}`;

}


function setLive(state, label) {

    const dot = getElement("live-dot");
    const text = getElement("live-label");

    if (dot) {
        dot.classList.toggle("is-error", state === "error");
        dot.classList.toggle("is-loading", state === "loading");
    }

    if (text) {
        text.textContent = label;
    }

}


/*
====================================================
LOAD INTELLIGENCE
====================================================
*/

// Remembers the last successful payload's generatedAt so the
// "Updated X ago" pill can keep re-ticking between fetches.
let lastGeneratedAt = null;
let relativeTimeInterval = null;

// Remembers the full last-loaded payload so the PDF export can
// build a report without re-fetching. Cleared to null only if a
// fetch has never succeeded.
let lastIntelligenceData = null;

function startRelativeTimeTicker() {

    if (relativeTimeInterval) {
        clearInterval(relativeTimeInterval);
    }

    relativeTimeInterval = setInterval(() => {
        if (lastGeneratedAt) {
            setLive("ok", `Updated ${relativeTime(lastGeneratedAt)}`);
        }
    }, RELATIVE_TIME_TICK_MS);

}


async function loadIntelligence() {

    const refreshButton = getElement("refresh-button");

    try {

        setStatus("Loading security intelligence\u2026", "loading");
        setLive("loading", "Connecting\u2026");

        if (refreshButton) {
            refreshButton.classList.add("is-loading");
            refreshButton.disabled = true;
        }

        console.log("Loading intelligence from:", INTELLIGENCE_API);

        const response = await fetch(INTELLIGENCE_API, {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });

        console.log("Intelligence HTTP status:", response.status);

        if (!response.ok) {
            throw new Error(`Intelligence API returned HTTP ${response.status}`);
        }

        const result = await response.json();

        console.log("Intelligence API response:", result);

        const data = result?.data || result?.intelligence || result;

        if (!data) {
            throw new Error("Intelligence API returned an empty response.");
        }

        renderIntelligence(data);

        setStatus("");

        lastGeneratedAt = data?.generatedAt || null;
        lastIntelligenceData = data;
        setLive("ok", lastGeneratedAt ? `Updated ${relativeTime(lastGeneratedAt)}` : "Live");
        startRelativeTimeTicker();

    }
    catch (error) {

        console.error("Intelligence loading failed:", error);

        setStatus(`Unable to load intelligence: ${error.message}`, "error");
        setLive("error", "Connection failed");

        showPageError(error.message);

    }
    finally {

        if (refreshButton) {
            refreshButton.classList.remove("is-loading");
            refreshButton.disabled = false;
        }

    }

}


/*
====================================================
RENDER EVERYTHING
====================================================
*/

function renderIntelligence(data) {

    console.log("Rendering intelligence:", data);

    renderOverview(data);
    renderFindings(data);
    renderPriorityQueue(data);
    renderComparison(data);
    renderLifecycle(data);

    // New security intelligence sections
    renderCaseOutcome(data);
    renderRiskAcceptance(data);
    renderAlertBreakdown(data);
    renderCyeraOperationalIntelligence(data);
    renderWorkload(data);
    renderDisposition(data);
    renderHighRiskCases(data);
    renderReport(data);
    renderGeneratedAt(data);

    // Chart panel (severity / status / comparison / lifecycle)
    renderCharts(data);

}


/*
====================================================
OVERVIEW / READOUT STRIP
====================================================
*/

function renderOverview(data) {

    const alerts = data?.alerts || {};
    const change = data?.comparison?.change || {};
    const secIntel = data?.securityIntelligence || {};

    const total = alerts.total ?? data?.totalAlerts ?? 0;
    const cyera = alerts.cyera ?? 0;
    const purview = alerts.purview ?? 0;
    const unassigned = alerts.unassigned ?? 0;
    const highRisk = secIntel?.risk?.highOrCritical ?? 0;
    const insights = Array.isArray(data?.insights) ? data.insights.length : 0;

    getElement("total-alerts").textContent = formatNumber(total);
    getElement("cyera-alerts").textContent = formatNumber(cyera);
    getElement("purview-alerts").textContent = formatNumber(purview);
    getElement("highrisk-alerts").textContent = formatNumber(highRisk);
    getElement("unassigned-alerts").textContent = formatNumber(unassigned);
    getElement("insight-count").textContent = formatNumber(insights);

    // Quiet pulse on the headline number when there's something to act on —
    // draws the eye without a popup or sound.
    const highRiskEl = getElement("highrisk-alerts");
    if (highRiskEl) {
        highRiskEl.classList.toggle("is-alert", Number(highRisk) > 0);
    }

    renderDelta("total-delta", change.totalAlerts, change.totalPercentage);
    renderDelta("cyera-delta", change.cyera, change.cyeraPercentage);
    renderDelta("purview-delta", change.purview, change.purviewPercentage);

}


function renderDelta(elementId, changeValue, percentageValue) {

    const el = getElement(elementId);

    if (!el) {
        return;
    }

    const change = Number(changeValue);

    if (!Number.isFinite(change)) {
        el.textContent = "";
        return;
    }

    const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
    const arrow = change > 0 ? "\u2191" : change < 0 ? "\u2193" : "\u2013";
    const sign = change > 0 ? "+" : "";
    const pct = Number.isFinite(Number(percentageValue))
        ? ` (${sign}${Number(percentageValue).toFixed(1)}%)`
        : "";

    el.className = `readout-delta ${direction}`;
    el.textContent = `${arrow} ${sign}${formatNumber(change)}${pct} vs prior`;

}




/*
====================================================
INTELLIGENCE FINDINGS
====================================================
*/

function priorityRank(priority) {

    const p =
        String(priority || "low").toLowerCase();

    if (p === "critical") return 0;
    if (p === "high") return 1;
    if (p === "medium") return 2;

    return 3;
}


/*
====================================================
RENDER FINDINGS
====================================================
*/

function renderFindings(data) {

    const container =
        getElement("insights-container");

    const meta =
        getElement("findings-meta");


    const insights =
        Array.isArray(data?.insights)
            ? [...data.insights]
            : [];


    /*
    ================================================
    NO FINDINGS
    ================================================
    */

    if (meta) {

        meta.textContent =
            insights.length
                ? `${insights.length} observations`
                : "";

    }


    if (!insights.length) {

        if (container) {

            container.innerHTML =
                emptyState(
                    "No intelligence findings were generated for this report.",
                    {
                        icon: "\u2713"
                    }
                );

        }


        const toggle =
            getElement("findings-toggle");

        if (toggle) {

            toggle.style.display =
                "none";

        }

        return;
    }


    /*
    ================================================
    SORT BY PRIORITY
    ================================================
    */

    insights.sort(
        (a, b) =>
            priorityRank(a.priority) -
            priorityRank(b.priority)
    );


    /*
    ================================================
    RENDER FINDINGS
    ================================================
    */

    container.innerHTML =
        insights
            .map(
                (insight, index) => {

                    const priority =
                        String(
                            insight.priority || "low"
                        ).toLowerCase();


                    const pClass =
                        priorityClass(priority);


                    const hasRecommendation =
                        Boolean(
                            insight.recommendedAction
                        );


                    return `

                        <div
                            class="finding-row row-anim finding-clickable"
                            style="${rowDelay(index)}"
                            data-finding-index="${index}"
                            role="button"
                            tabindex="0"
                            aria-label="View finding details">

                            <div
                                class="finding-bar ${pClass}">
                            </div>


                            <div class="finding-content">

                                <div class="finding-top">

                                    <span class="finding-type">

                                        ${escapeHTML(
                                            formatInsightType(
                                                insight.type
                                            )
                                        )}

                                    </span>


                                    <span
                                        class="badge ${pClass}">

                                        ${escapeHTML(
                                            priority
                                        )}

                                    </span>

                                </div>


                                <div class="finding-message">

                                    ${escapeHTML(
                                        insight.message ||
                                        "No description available."
                                    )}

                                </div>


                                ${
                                    hasRecommendation
                                        ? `

                                            <div
                                                class="finding-action-hint">

                                                <span>
                                                    Recommended action
                                                </span>

                                                <span
                                                    class="finding-action-arrow">

                                                    →

                                                </span>

                                            </div>

                                          `
                                        : ""
                                }

                            </div>

                        </div>

                    `;

                }
            )
            .join("");


    /*
    ================================================
    CLICK / KEYBOARD HANDLERS
    ================================================
    */

    container
        .querySelectorAll(
            ".finding-clickable"
        )
        .forEach(
            row => {

                const index =
                    Number(
                        row.dataset.findingIndex
                    );


                const insight =
                    insights[index];


                const openDetails =
                    () => {

                        openFindingDetails(
                            insight
                        );

                    };


                /*
                ------------------------------------
                MOUSE
                ------------------------------------
                */

                row.addEventListener(
                    "click",
                    openDetails
                );


                /*
                ------------------------------------
                KEYBOARD
                ------------------------------------
                */

                row.addEventListener(
                    "keydown",
                    event => {

                        if (
                            event.key === "Enter" ||
                            event.key === " "
                        ) {

                            event.preventDefault();

                            openDetails();

                        }

                    }
                );

            }
        );


    /*
    ================================================
    PROGRESSIVE DISCLOSURE
    ================================================
    */

    requestAnimationFrame(
        () => {

            const wrap =
                getElement(
                    "findings-wrap"
                );

            const toggle =
                getElement(
                    "findings-toggle"
                );


            if (
                !wrap ||
                !toggle
            ) {

                return;

            }


            wrap.classList.remove(
                "expanded"
            );


            toggle.textContent =
                "Show all findings";


            const overflowing =
                container.scrollHeight >
                280;


            toggle.style.display =
                overflowing
                    ? "block"
                    : "none";

        }
    );

}


/*
====================================================
FINDING DETAILS MODAL
====================================================
*/

function openFindingDetails(
    finding
) {

    if (!finding) {
        return;
    }


    /*
    ================================================
    FIND OR CREATE MODAL
    ================================================
    */

    let modal =
        document.getElementById(
            "finding-detail-modal"
        );


    if (!modal) {

        modal =
            document.createElement(
                "div"
            );


        modal.id =
            "finding-detail-modal";


        modal.className =
            "finding-detail-modal";


        modal.innerHTML = `

            <div
                class="finding-detail-backdrop"
                data-finding-close>
            </div>


            <div
                class="finding-detail-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="finding-detail-title">


                <button
                    type="button"
                    class="finding-detail-close"
                    data-finding-close
                    aria-label="Close finding details">

                    ×

                </button>


                <div
                    class="finding-detail-header">

                    <div>

                        <span
                            class="finding-detail-kicker"
                            id="finding-detail-type">
                        </span>


                        <h3
                            id="finding-detail-title">
                        </h3>

                    </div>


                    <span
                        id="finding-detail-priority"
                        class="badge">
                    </span>

                </div>


                <div
                    class="finding-detail-body">


                    <!--
                    =================================
                    OBSERVATION
                    =================================
                    -->

                    <section
                        class="finding-detail-section">

                        <span
                            class="finding-detail-label">

                            Observation

                        </span>


                        <p
                            id="finding-detail-description">
                        </p>

                    </section>


                    <!--
                    =================================
                    RECOMMENDED ACTION
                    =================================
                    -->

                    <section
                        class="finding-detail-section finding-recommended-section">

                        <span
                            class="finding-detail-label">

                            Recommended action

                        </span>


                        <p
                            id="finding-detail-action">
                        </p>

                    </section>

                </div>

            </div>

        `;


        document.body.appendChild(
            modal
        );


        /*
        ================================================
        CLOSE BUTTON + BACKDROP
        ================================================
        */

        modal
            .querySelectorAll(
                "[data-finding-close]"
            )
            .forEach(
                element => {

                    element.addEventListener(
                        "click",
                        closeFindingDetails
                    );

                }
            );

    }


    /*
    ================================================
    FINDING VALUES
    ================================================
    */

    const priority =
        String(
            finding.priority || "low"
        ).toLowerCase();


    const pClass =
        priorityClass(
            priority
        );


    /*
    ================================================
    TYPE
    ================================================
    */

    const typeElement =
        document.getElementById(
            "finding-detail-type"
        );


    if (typeElement) {

        typeElement.textContent =
            formatInsightType(
                finding.type
            );

    }


    /*
    ================================================
    TITLE
    ================================================
    */

    const titleElement =
        document.getElementById(
            "finding-detail-title"
        );


    if (titleElement) {

        titleElement.textContent =
            finding.title ||
            formatInsightType(
                finding.type
            );

    }


    /*
    ================================================
    PRIORITY
    ================================================
    */

    const priorityElement =
        document.getElementById(
            "finding-detail-priority"
        );


    if (priorityElement) {

        priorityElement.textContent =
            priority;


        priorityElement.className =
            `badge ${pClass}`;

    }


    /*
    ================================================
    DESCRIPTION
    ================================================
    */

    const descriptionElement =
        document.getElementById(
            "finding-detail-description"
        );


    if (descriptionElement) {

        descriptionElement.textContent =
            finding.message ||
            "No description available.";

    }


    /*
    ================================================
    RECOMMENDED ACTION
    ================================================
    */

    const actionElement =
        document.getElementById(
            "finding-detail-action"
        );


    if (actionElement) {

        actionElement.textContent =
            finding.recommendedAction ||
            "No recommended action was provided for this finding.";

    }


    /*
    ================================================
    SHOW MODAL
    ================================================
    */

    modal.classList.add(
        "visible"
    );


    document.body.classList.add(
        "modal-open"
    );


    /*
    ================================================
    ESCAPE KEY
    ================================================
    */

    const escapeHandler =
        event => {

            if (
                event.key === "Escape"
            ) {

                closeFindingDetails();

            }

        };


    modal._escapeHandler =
        escapeHandler;


    document.addEventListener(
        "keydown",
        escapeHandler
    );

}


/*
====================================================
CLOSE FINDING DETAILS
====================================================
*/

function closeFindingDetails() {

    const modal =
        document.getElementById(
            "finding-detail-modal"
        );


    if (!modal) {
        return;
    }


    modal.classList.remove(
        "visible"
    );


    document.body.classList.remove(
        "modal-open"
    );


    /*
    ================================================
    REMOVE ESCAPE LISTENER
    ================================================
    */

    if (
        modal._escapeHandler
    ) {

        document.removeEventListener(
            "keydown",
            modal._escapeHandler
        );


        modal._escapeHandler =
            null;

    }

}


/*
====================================================
FORMAT FINDING TYPE
====================================================
*/

function formatInsightType(
    type
) {

    if (!type) {
        return "Observation";
    }


    return String(type)
        .replace(
            /_/g,
            " "
        )
        .replace(
            /\b\w/g,
            char =>
                char.toUpperCase()
        );

}


/*
====================================================
PRIORITY QUEUE
====================================================
*/

function renderPriorityQueue(data) {

    const container = getElement("queue-container");

    const alerts = Array.isArray(data?.prioritization?.alerts)
        ? [...data.prioritization.alerts]
        : [];

    if (!alerts.length) {
        container.innerHTML = emptyState("No alerts are currently queued for review.", { icon: "\u2713" });
        return;
    }

    alerts.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

    const top = alerts.slice(0, 8);
    const maxScore = Math.max(...top.map(a => a.priorityScore ?? 0), 1);

    container.innerHTML = top
        .map((alert, index) => {

            const pClass = priorityClass(alert.priority);
            const sevTone = severityToTone(alert.severity);
            const scorePct = Math.max(4, Math.min(100, ((alert.priorityScore ?? 0) / maxScore) * 100));

            const reasons = Array.isArray(alert.reasons) ? alert.reasons.slice(0, 3) : [];
            const extraReasons = Array.isArray(alert.reasons) ? alert.reasons.length - reasons.length : 0;

            const reasonChips = reasons
                .map(reason => `<span class="chip">${escapeHTML(reason)}</span>`)
                .join("") + (extraReasons > 0 ? `<span class="chip">+${extraReasons} more</span>` : "");

            const statusChip = alert.status
                ? `<span class="chip chip-status">${escapeHTML(formatInsightType(alert.status))}</span>`
                : "";

            return `
                <div class="queue-row row-anim" style="${rowDelay(index, 30)}">

                    <div class="queue-rank">${String(index + 1).padStart(2, "0")}</div>

                    <div class="queue-main">

                        <div class="queue-name-row">
                            <span class="sev-dot sev-${escapeHTML(String(alert.severity || "unknown").toLowerCase())}"></span>
                            <span class="queue-name" title="${escapeHTML(alert.name || "Untitled alert")}">${escapeHTML(alert.name || "Untitled alert")}</span>
                        </div>

                        <div class="queue-chips">
                            ${statusChip}
                            ${reasonChips}
                        </div>

                    </div>

                    <div class="queue-score">
                        <span class="queue-score-value">${formatNumber(alert.priorityScore ?? 0)}</span>
                        <div class="score-gauge">
                            <div class="score-gauge-fill ${pClass}" style="width:${scorePct}%;"></div>
                        </div>
                    </div>

                </div>
            `;

        })
        .join("");

    animateFills(container);

}


/*
====================================================
COMPARISON
====================================================
*/

function renderComparisonCard(label, current, previous, change, percentage, index = 0) {

    const c = Number(change);
    const direction = c > 0 ? "up" : c < 0 ? "down" : "flat";
    const arrow = c > 0 ? "\u2191" : c < 0 ? "\u2193" : "\u2013";
    const sign = c > 0 ? "+" : "";

    return `
        <div class="compare-card row-anim" style="${rowDelay(index, 60)}">
            <div class="compare-label">${escapeHTML(label)}</div>
            <div class="compare-values">
                <span class="compare-current">${formatNumber(current)}</span>
                <span class="compare-previous">from ${formatNumber(previous)}</span>
            </div>
            <div class="compare-delta ${direction}">
                ${arrow} ${sign}${formatNumber(change)}
                (${sign}${formatPercentage(percentage)})
            </div>
        </div>
    `;

}


function renderComparison(data) {

    const container = getElement("comparison-container");
    const comparison = data?.comparison;

    if (!comparison) {
        container.innerHTML = emptyState("No comparison data available.");
        return;
    }

    const currentReport = comparison.currentReport || {};
    const previousReport = comparison.previousReport || {};
    const change = comparison.change || {};

    container.innerHTML =
        renderComparisonCard(
            "Total Alerts",
            currentReport.totalAlerts ?? comparison.current ?? 0,
            previousReport.totalAlerts ?? comparison.previous ?? 0,
            change.totalAlerts ?? 0,
            change.totalPercentage ?? 0,
            0
        ) +
        renderComparisonCard(
            "Cyera",
            currentReport.cyera ?? 0,
            previousReport.cyera ?? 0,
            change.cyera ?? 0,
            change.cyeraPercentage ?? 0,
            1
        ) +
        renderComparisonCard(
            "Purview",
            currentReport.purview ?? 0,
            previousReport.purview ?? 0,
            change.purview ?? 0,
            change.purviewPercentage ?? 0,
            2
        );

}


/*
====================================================
LIFECYCLE
====================================================
*/

function renderLifecycle(data) {

    const container = getElement("lifecycle-container");
    const lifecycle = data?.lifecycle;

    if (!lifecycle) {
        container.innerHTML = emptyState("No lifecycle data available.");
        return;
    }

    const total = Number(lifecycle.currentAlerts ?? lifecycle.total ?? 0);
    const newAlerts = Number(lifecycle.new ?? 0);
    const carriedOver = Number(lifecycle.carriedOver ?? 0);

    const newPercentage = Number(
        lifecycle.newPercentage ?? (total > 0 ? (newAlerts / total) * 100 : 0)
    );

    const carriedPercentage = Number(
        lifecycle.carriedOverPercentage ?? (total > 0 ? (carriedOver / total) * 100 : 0)
    );

    container.innerHTML = `

        <div class="lifecycle-bar">
            <div class="lifecycle-new" style="width:${Math.min(newPercentage, 100)}%;"></div>
            <div class="lifecycle-carried" style="width:${Math.min(carriedPercentage, 100)}%;"></div>
        </div>

        <div class="lifecycle-legend">

            <div class="lifecycle-legend-row">
                <span class="lifecycle-legend-key">
                    <span class="legend-swatch new"></span>
                    New this report
                </span>
                <span class="lifecycle-legend-value">
                    ${formatNumber(newAlerts)} (${formatPercentage(newPercentage)})
                </span>
            </div>

            <div class="lifecycle-legend-row">
                <span class="lifecycle-legend-key">
                    <span class="legend-swatch carried"></span>
                    Carried over
                </span>
                <span class="lifecycle-legend-value">
                    ${formatNumber(carriedOver)} (${formatPercentage(carriedPercentage)})
                </span>
            </div>

        </div>

    `;

    animateFills(container);

}

/*
====================================================
CASE OUTCOME
====================================================
*/

function renderCaseOutcome(data) {

    const container = getElement("case-outcome-container");

    if (!container) {
        return;
    }

    /*
    Support both:

        data.caseOutcome

    and:

        data.securityIntelligence.caseOutcome

    This keeps the frontend tolerant of either API shape.
    */
    const caseOutcome =
        data?.caseOutcome ||
        data?.securityIntelligence?.caseOutcome;

    if (!caseOutcome) {
        container.innerHTML =
            emptyState("No case outcome data available.");

        return;
    }

    const totalCases =
        Number(caseOutcome.totalCases ?? 0);

    const outcomes =
        caseOutcome.outcomes || {};

    const disposition =
        caseOutcome.disposition || {};

    const active =
        caseOutcome.active || {};

    const riskAcceptance =
        caseOutcome.riskAcceptance || {};

    const formalClosure =
        caseOutcome.formalClosure || {};

    const dispositioned =
        Number(disposition.total ?? 0);

    const activeCases =
        Number(active.total ?? 0);

    const riskAccepted =
        Number(riskAcceptance.total ?? 0);

    const closure =
        Number(formalClosure.total ?? 0);

    const outcomeEntries = [
        {
            label: "Open",
            value: Number(outcomes.open ?? 0),
            tone: "amber"
        },
        {
            label: "Risk accepted",
            value: Number(outcomes.riskAccepted ?? 0),
            tone: "blue"
        },
        {
            label: "False positive",
            value: Number(outcomes.falsePositive ?? 0),
            tone: "green"
        },
        {
            label: "Resolved",
            value: Number(outcomes.resolved ?? 0),
            tone: "green"
        },
        {
            label: "Closed",
            value: Number(outcomes.closed ?? 0),
            tone: "green"
        }
    ].filter(item => item.value > 0);

    const maxOutcome =
        Math.max(
            ...outcomeEntries.map(item => item.value),
            1
        );

    const severityDispositioned =
        caseOutcome.severity?.dispositioned || {};

    const severityActive =
        caseOutcome.severity?.active || {};

    const severityRows = [
        {
            label: "Critical",
            dispositioned: Number(severityDispositioned.critical ?? 0),
            active: Number(severityActive.critical ?? 0)
        },
        {
            label: "High",
            dispositioned: Number(severityDispositioned.high ?? 0),
            active: Number(severityActive.high ?? 0)
        },
        {
            label: "Medium",
            dispositioned: Number(severityDispositioned.medium ?? 0),
            active: Number(severityActive.medium ?? 0)
        },
        {
            label: "Low",
            dispositioned: Number(severityDispositioned.low ?? 0),
            active: Number(severityActive.low ?? 0)
        }
    ].filter(
        row =>
            row.dispositioned > 0 ||
            row.active > 0
    );

    container.innerHTML = `

        <!-- SUMMARY -->

        <div class="intel-summary-grid">

            <div class="intel-stat">
                <span>All Cases</span>
                <strong>${formatNumber(totalCases)}</strong>
            </div>

            <div class="intel-stat">
                <span>Active</span>
                <strong class="accent-amber">
                    ${formatNumber(activeCases)}
                </strong>
                <small>
                    ${formatPercentage(active.rate)}
                </small>
            </div>

            <div class="intel-stat">
                <span>Dispositioned</span>
                <strong>
                    ${formatNumber(dispositioned)}
                </strong>
                <small>
                    ${formatPercentage(disposition.rate)}
                </small>
            </div>

            <div class="intel-stat">
                <span>Risk Accepted</span>
                <strong class="accent-blue">
                    ${formatNumber(riskAccepted)}
                </strong>
                <small>
                    ${formatPercentage(riskAcceptance.rate)}
                </small>
            </div>

        </div>


        <!-- OUTCOME DISTRIBUTION -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Outcome distribution
            </div>

            <div class="intel-bars">

                ${outcomeEntries.length
            ? outcomeEntries.map((item, index) => {

                const width =
                    Math.max(
                        4,
                        Math.min(
                            100,
                            (item.value / maxOutcome) * 100
                        )
                    );

                return `
                                <div
                                    class="intel-bar-row row-anim"
                                    style="${rowDelay(index, 35)}"
                                >
                                    <span class="intel-bar-label">
                                        ${escapeHTML(item.label)}
                                    </span>

                                    <div class="intel-bar-track">
                                        <div
                                            class="intel-bar-fill tone-${item.tone}"
                                            style="width:${width}%"
                                        ></div>
                                    </div>

                                    <span class="intel-bar-value">
                                        ${formatNumber(item.value)}
                                    </span>
                                </div>
                            `;

            }).join("")

            : emptyState("No outcome distribution available.")
        }

            </div>

        </div>


        <!-- SEVERITY -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Severity profile
            </div>

            <div class="case-severity-table">

                <div class="case-severity-header">
                    <span>Severity</span>
                    <span>Active</span>
                    <span>Dispositioned</span>
                </div>

                ${severityRows.length
            ? severityRows.map((row, index) => `
                            <div
                                class="case-severity-row row-anim"
                                style="${rowDelay(index, 35)}"
                            >
                                <span class="case-severity-name">
                                    <span class="sev-dot sev-${row.label.toLowerCase()}"></span>
                                    ${escapeHTML(row.label)}
                                </span>

                                <span class="case-severity-value">
                                    ${formatNumber(row.active)}
                                </span>

                                <span class="case-severity-value">
                                    ${formatNumber(row.dispositioned)}
                                </span>
                            </div>
                        `).join("")

            : `
                            <div class="intel-empty-inline">
                                No severity data available.
                            </div>
                        `
        }

            </div>

        </div>


        <!-- CLOSURE STATUS -->

        <div class="intel-footnote">

            <span>
                Formal closure
            </span>

            <strong>
                ${formatNumber(closure)}
                (${formatPercentage(formalClosure.rate)})
            </strong>

        </div>

    `;

    animateFills(container);
}
/*
====================================================
RISK ACCEPTANCE
====================================================
*/

function renderRiskAcceptance(data) {

    const container =
        getElement("risk-acceptance-container");

    if (!container) {
        return;
    }

    const riskAcceptance =
        data?.riskAcceptance ||
        data?.securityIntelligence?.riskAcceptance;

    if (!riskAcceptance) {
        container.innerHTML =
            emptyState("No risk acceptance data available.");

        return;
    }

    const total =
        Number(riskAcceptance.totalRiskAccepted ?? 0);

    const highRisk =
        riskAcceptance.highRisk || {};

    const aging =
        riskAcceptance.aging || {};

    const severity =
        riskAcceptance.severity || {};

    const concentration =
        riskAcceptance.concentration || {};

    const topPatterns =
        Array.isArray(concentration.topAlertPatterns)
            ? concentration.topAlertPatterns
            : [];

    const topOwners =
        Array.isArray(concentration.topOwners)
            ? concentration.topOwners
            : [];

    const agingBuckets =
        aging.buckets || {};

    const severityEntries = [
        {
            label: "Critical",
            value: Number(severity.critical ?? 0),
            tone: "red"
        },
        {
            label: "High",
            value: Number(severity.high ?? 0),
            tone: "red"
        },
        {
            label: "Medium",
            value: Number(severity.medium ?? 0),
            tone: "amber"
        },
        {
            label: "Low",
            value: Number(severity.low ?? 0),
            tone: "green"
        }
    ].filter(item => item.value > 0);

    const maxSeverity =
        Math.max(
            ...severityEntries.map(item => item.value),
            1
        );

    container.innerHTML = `

        <!-- HERO METRICS -->

        <div class="risk-hero">

            <div class="risk-total">

                <span>
                    Total risk accepted
                </span>

                <strong>
                    ${formatNumber(total)}
                </strong>

            </div>

            <div class="risk-high">

                <span>
                    High / Critical
                </span>

                <strong>
                    ${formatNumber(highRisk.total ?? 0)}
                </strong>

                <small>
                    ${formatPercentage(highRisk.rate)}
                </small>

            </div>

        </div>


        <!-- AGING -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Acceptance aging
            </div>

            <div class="aging-metrics">

                <div>
                    <span>Average age</span>
                    <strong>
                        ${Number(aging.averageDays ?? 0).toFixed(1)}d
                    </strong>
                </div>

                <div>
                    <span>Oldest</span>
                    <strong>
                        ${Number(aging.oldestDays ?? 0).toFixed(1)}d
                    </strong>
                </div>

                <div>
                    <span>Over 30d</span>
                    <strong>
                        ${formatNumber(aging.over30Days ?? 0)}
                    </strong>
                </div>

                <div>
                    <span>Over 90d</span>
                    <strong>
                        ${formatNumber(aging.over90Days ?? 0)}
                    </strong>
                </div>

            </div>


            <div class="aging-buckets">

                ${[
            ["0-7", agingBuckets["0-7"] ?? 0],
            ["8-30", agingBuckets["8-30"] ?? 0],
            ["31-90", agingBuckets["31-90"] ?? 0],
            ["90+", agingBuckets["90+"] ?? 0]
        ].map(([label, value]) => `
                    <div class="aging-bucket">

                        <span>${escapeHTML(label)} days</span>

                        <strong>
                            ${formatNumber(value)}
                        </strong>

                    </div>
                `).join("")}

            </div>

        </div>


        <!-- SEVERITY -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Accepted risk by severity
            </div>

            ${severityEntries.length
            ? severityEntries.map((item, index) => {

                const width =
                    Math.max(
                        4,
                        Math.min(
                            100,
                            (item.value / maxSeverity) * 100
                        )
                    );

                return `
                            <div
                                class="intel-bar-row row-anim"
                                style="${rowDelay(index, 35)}"
                            >
                                <span class="intel-bar-label">
                                    ${escapeHTML(item.label)}
                                </span>

                                <div class="intel-bar-track">
                                    <div
                                        class="intel-bar-fill tone-${item.tone}"
                                        style="width:${width}%"
                                    ></div>
                                </div>

                                <span class="intel-bar-value">
                                    ${formatNumber(item.value)}
                                </span>
                            </div>
                        `;

            }).join("")

            : `
                        <div class="intel-empty-inline">
                            No severity data available.
                        </div>
                    `
        }

        </div>


        <!-- CONCENTRATION -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Top accepted-risk patterns
            </div>

            <div class="risk-list">

                ${topPatterns.length
            ? topPatterns.slice(0, 5).map((item, index) => `
                            <div
                                class="risk-list-row row-anim"
                                style="${rowDelay(index, 35)}"
                            >
                                <div class="risk-list-main">

                                    <span class="risk-list-name"
                                        title="${escapeHTML(item.name)}">
                                        ${escapeHTML(item.name)}
                                    </span>

                                </div>

                                <div class="risk-list-count">

                                    <strong>
                                        ${formatNumber(item.count)}
                                    </strong>

                                    <span>
                                        ${formatPercentage(item.rate)}
                                    </span>

                                </div>

                            </div>
                        `).join("")

            : `
                            <div class="intel-empty-inline">
                                No recurring patterns identified.
                            </div>
                        `
        }

            </div>

        </div>


        <!-- OWNERS -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Risk acceptance owners
            </div>

            <div class="risk-list">

                ${topOwners.length
            ? topOwners.slice(0, 5).map((item, index) => `
                            <div
                                class="risk-list-row row-anim"
                                style="${rowDelay(index, 35)}"
                            >
                                <div class="risk-list-main">

                                    <span class="risk-list-name"
                                        title="${escapeHTML(item.name)}">
                                        ${escapeHTML(item.name)}
                                    </span>

                                </div>

                                <div class="risk-list-count">

                                    <strong>
                                        ${formatNumber(item.count)}
                                    </strong>

                                    <span>
                                        ${formatPercentage(item.rate)}
                                    </span>

                                </div>

                            </div>
                        `).join("")

            : `
                            <div class="intel-empty-inline">
                                No owner concentration data available.
                            </div>
                        `
        }

            </div>

        </div>

    `;

    animateFills(container);
}


/*
====================================================
CYERA OPERATIONAL INTELLIGENCE
(cyeraOperationalIntelligence)
====================================================
Reads data.cyeraOperationalIntelligence and renders
into #operational-intelligence-container /
#operational-intelligence-meta.

This represents the CURRENT Cyera environment state,
not the number of alerts contained in the latest report.
====================================================
*/

function renderCyeraOperationalIntelligence(data) {

    const container =
        getElement("operational-intelligence-container");

    if (!container) {
        return;
    }

    const intel =
        data?.cyeraOperationalIntelligence;

    const meta =
        getElement("operational-intelligence-meta");

    if (!intel) {

        container.innerHTML =
            emptyState(
                "No Cyera operational intelligence available."
            );

        if (meta) {
            meta.textContent = "";
        }

        return;
    }


    /*
    ====================================================
    META
    ====================================================
    */

    if (meta) {

        const asOfReport =
            intel.asOfReport ||
            intel.reportId ||
            "";

        meta.textContent =
            asOfReport
                ? `As of ${asOfReport}`
                : "Current Cyera state";
    }


    /*
    ====================================================
    CURRENT STATE
    ====================================================
    */

    const current =
        intel.currentState || {};


    const total =
        Number(current.totalAlerts ?? 0);

    const open =
        Number(current.open ?? 0);

    const inProgress =
        Number(current.inProgress ?? 0);

    const handled =
        Number(current.handled ?? 0);

    const unassigned =
        Number(current.unassigned ?? 0);

    const handledRate =
        Number(current.handledRate ?? 0);

    const unassignedRate =
        Number(current.unassignedRate ?? 0);

    const highRiskActive =
        Number(current.highRiskActive ?? 0);

    const highRiskUnassigned =
        Number(current.highRiskUnassigned ?? 0);


    /*
    ====================================================
    HIGH / CRITICAL OUTCOME
    ====================================================
    */

    const highRisk =
        intel.highRiskOutcome || {};

    const highRiskTotal =
        Number(highRisk.total ?? 0);

    const critical =
        Number(highRisk.critical ?? 0);

    const high =
        Number(highRisk.high ?? 0);

    const riskAccepted =
        Number(highRisk.riskAccepted ?? 0);

    const falsePositive =
        Number(highRisk.falsePositive ?? 0);

    const resolvedOrClosed =
        Number(highRisk.resolvedOrClosed ?? 0);

    const highRiskInProgress =
        Number(highRisk.inProgress ?? 0);

    const highRiskOpen =
        Number(highRisk.open ?? 0);

    const highRiskOpenUnassigned =
        Number(highRisk.openUnassigned ?? 0);

    const criticalRiskAccepted =
        Number(highRisk.criticalRiskAccepted ?? 0);

    const highRiskAccepted =
        Number(highRisk.highRiskAccepted ?? 0);


    /*
    ====================================================
    ANALYST ACTIVITY
    ====================================================
    */

    const analysts =
        Array.isArray(intel.analystActivity)
            ? [...intel.analystActivity].sort(
                (a, b) =>
                    Number(b.handledActions ?? 0) -
                    Number(a.handledActions ?? 0)
            )
            : [];

    const analystSummary =
        intel.analystActivitySummary || {};


    /*
    ====================================================
    WORK STATE
    ====================================================
    */

    const workStateEntries = [

        {
            label: "Open / unassigned",
            value: unassigned,
            tone: "amber"
        },

        {
            label: "In progress",
            value: inProgress,
            tone: "blue"
        },

        {
            label: "Handled",
            value: handled,
            tone: "green"
        }

    ].filter(
        item => item.value > 0
    );


    const maxWorkState =
        Math.max(
            ...workStateEntries.map(
                item => item.value
            ),
            1
        );


    /*
    ====================================================
    HIGH-RISK OUTCOME BARS
    ====================================================
    */

    const highRiskEntries = [

        {
            label: "Risk accepted",
            value: riskAccepted,
            tone: "blue"
        },

        {
            label: "False positive",
            value: falsePositive,
            tone: "green"
        },

        {
            label: "In progress",
            value: highRiskInProgress,
            tone: "amber"
        },

        {
            label: "Resolved / closed",
            value: resolvedOrClosed,
            tone: "green"
        },

        {
            label: "Open",
            value: highRiskOpen,
            tone: "red"
        }

    ].filter(
        item => item.value > 0
    );


    const maxHighRisk =
        Math.max(
            ...highRiskEntries.map(
                item => item.value
            ),
            1
        );


    /*
    ====================================================
    RENDER
    ====================================================
    */

    container.innerHTML = `

        <!-- CURRENT STATE SUMMARY -->

        <div class="intel-summary-grid">

            <div class="intel-stat">

                <span>Total Cyera alerts</span>

                <strong>
                    ${formatNumber(total)}
                </strong>

            </div>


            <div class="intel-stat">

                <span>Open</span>

                <strong class="accent-amber">
                    ${formatNumber(open)}
                </strong>

            </div>


            <div class="intel-stat">

                <span>Handled</span>

                <strong>
                    ${formatNumber(handled)}
                </strong>

                <small>
                    ${formatPercentage(handledRate)}
                    of current state
                </small>

            </div>


            <div class="intel-stat">

                <span>Unassigned</span>

                <strong class="accent-amber">
                    ${formatNumber(unassigned)}
                </strong>

                <small>
                    ${formatPercentage(unassignedRate)}
                    of current state
                </small>

            </div>


            <div class="intel-stat">

                <span>High / critical active</span>

                <strong
                    class="${highRiskActive > 0
                        ? "accent-amber"
                        : ""}"
                >
                    ${formatNumber(highRiskActive)}
                </strong>

            </div>


            <div class="intel-stat">

                <span>High-risk unassigned</span>

                <strong
                    class="${highRiskUnassigned > 0
                        ? "accent-red"
                        : ""}"
                >
                    ${formatNumber(highRiskUnassigned)}
                </strong>

            </div>

        </div>


        <!-- WORK STATE -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Current work state
            </div>

            <div class="intel-bars">

                ${
                    workStateEntries.length

                        ? workStateEntries
                            .map((item, index) => {

                                const width =
                                    Math.max(
                                        4,
                                        Math.min(
                                            100,
                                            (item.value /
                                                maxWorkState) *
                                            100
                                        )
                                    );

                                return `

                                    <div
                                        class="intel-bar-row row-anim"
                                        style="${rowDelay(index, 35)}"
                                    >

                                        <span class="intel-bar-label">
                                            ${escapeHTML(item.label)}
                                        </span>

                                        <div class="intel-bar-track">

                                            <div
                                                class="intel-bar-fill tone-${item.tone}"
                                                style="width:${width}%"
                                            ></div>

                                        </div>

                                        <span class="intel-bar-value">
                                            ${formatNumber(item.value)}
                                        </span>

                                    </div>

                                `;

                            })
                            .join("")

                        : `
                            <div class="intel-empty-inline">
                                No active work state data available.
                            </div>
                        `
                }

            </div>

        </div>


        <!-- HIGH / CRITICAL -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                High / critical outcomes
            </div>


            <div class="risk-hero">

                <div class="risk-total">

                    <span>
                        High / critical
                    </span>

                    <strong>
                        ${formatNumber(highRiskTotal)}
                    </strong>

                    <small>
                        ${formatNumber(critical)} critical
                        &middot;
                        ${formatNumber(high)} high
                    </small>

                </div>


                <div class="risk-high">

                    <span>
                        Reviewed
                    </span>

                    <strong>
                        ${formatNumber(
                            riskAccepted +
                            falsePositive +
                            resolvedOrClosed
                        )}
                    </strong>

                    <small>
                        ${formatNumber(criticalRiskAccepted)}
                        critical accepted
                        &middot;
                        ${formatNumber(highRiskAccepted)}
                        high accepted
                    </small>

                </div>

            </div>


            <div
                class="intel-bars"
                style="margin-top:14px;"
            >

                ${
                    highRiskEntries.length

                        ? highRiskEntries
                            .map((item, index) => {

                                const width =
                                    Math.max(
                                        4,
                                        Math.min(
                                            100,
                                            (item.value /
                                                maxHighRisk) *
                                            100
                                        )
                                    );

                                return `

                                    <div
                                        class="intel-bar-row row-anim"
                                        style="${rowDelay(index, 35)}"
                                    >

                                        <span class="intel-bar-label">
                                            ${escapeHTML(item.label)}
                                        </span>

                                        <div class="intel-bar-track">

                                            <div
                                                class="intel-bar-fill tone-${item.tone}"
                                                style="width:${width}%"
                                            ></div>

                                        </div>

                                        <span class="intel-bar-value">
                                            ${formatNumber(item.value)}
                                        </span>

                                    </div>

                                `;

                            })
                            .join("")

                        : `
                            <div class="intel-empty-inline">
                                No high-risk outcome data available.
                            </div>
                        `
                }

            </div>

        </div>


        <!-- ANALYST ACTIVITY -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Analyst activity
            </div>


            ${
                analysts.length

                    ? `

                        <div class="case-severity-table">

                            <div class="case-severity-header">

                                <span>Analyst</span>

                                <span>Handled</span>

                                <span>Assignments</span>

                            </div>


                            ${
                                analysts
                                    .map((analyst, index) => `

                                        <div
                                            class="case-severity-row row-anim"
                                            style="${rowDelay(index, 35)}"
                                        >

                                            <span
                                                class="case-severity-name"
                                                title="${escapeHTML(
                                                    analyst.analyst || ""
                                                )}"
                                            >
                                                ${escapeHTML(
                                                    analyst.analyst ||
                                                    "Unknown analyst"
                                                )}
                                            </span>


                                            <span class="case-severity-value">
                                                ${formatNumber(
                                                    analyst.handledActions ?? 0
                                                )}
                                            </span>


                                            <span class="case-severity-value">
                                                ${formatNumber(
                                                    analyst.assignmentActions ?? 0
                                                )}
                                            </span>

                                        </div>

                                    `)
                                    .join("")
                            }

                        </div>

                    `

                    : `
                        <div class="intel-empty-inline">
                            No analyst activity recorded.
                        </div>
                    `
            }

        </div>


        <!-- SUMMARY -->

        <div class="intel-footnote">

            <span>
                ${formatNumber(
                    analystSummary.analysts ?? analysts.length
                )}
                analysts
            </span>

            <strong>
                ${formatNumber(
                    analystSummary.totalHandledActions ?? 0
                )}
                handled actions
            </strong>

        </div>

    `;


    animateFills(container);
}
/*
====================================================
ANALYST WORKLOAD  (cyeraWorkIntelligence)
====================================================
Reads data.cyeraWorkIntelligence and renders into
#workload-container / #workload-meta.
*/

function renderWorkload(data) {

    const container =
        getElement("workload-container");

    if (!container) {
        return;
    }

    const work =
        data?.cyeraWorkIntelligence;

    const meta =
        getElement("workload-meta");

    if (!work) {
        container.innerHTML =
            emptyState("No workload data available.");

        if (meta) {
            meta.textContent = "";
        }

        return;
    }

    if (meta) {
        meta.textContent = work.reportId || "";
    }

    const workload =
        work.workload || {};

    const workState =
        work.workState || {};

    const severity =
        work.severity || {};

    const analystActivity =
        Array.isArray(work.analystActivity)
            ? [...work.analystActivity].sort(
                (a, b) => (b.handledActions ?? 0) - (a.handledActions ?? 0)
            )
            : [];

    const summary =
        work.analystActivitySummary || {};

    // Work state buckets, each mapped to a bar tone
    const stateEntries = [
        { label: "Unassigned (open)", value: Number(workState.openUnassigned ?? 0), tone: "amber" },
        { label: "In progress", value: Number(workState.inProgress ?? 0), tone: "blue" },
        { label: "Assigned (open)", value: Number(workState.openAssigned ?? 0), tone: "amber" },
        { label: "High-risk unassigned", value: Number(workState.highRiskUnassigned ?? 0), tone: "red" },
        { label: "High-risk assigned", value: Number(workState.highRiskAssigned ?? 0), tone: "red" },
        { label: "Handled", value: Number(workState.handled ?? 0), tone: "green" },
        { label: "Other", value: Number(workState.other ?? 0), tone: "grey" }
    ].filter(item => item.value > 0);

    const maxState =
        Math.max(...stateEntries.map(item => item.value), 1);

    const severityEntries = [
        { label: "Critical", value: Number(severity.critical ?? 0), tone: "red" },
        { label: "High", value: Number(severity.high ?? 0), tone: "red" },
        { label: "Medium", value: Number(severity.medium ?? 0), tone: "amber" },
        { label: "Low", value: Number(severity.low ?? 0), tone: "green" },
        { label: "Unknown", value: Number(severity.unknown ?? 0), tone: "grey" }
    ].filter(item => item.value > 0);

    const maxSeverity =
        Math.max(...severityEntries.map(item => item.value), 1);

    container.innerHTML = `

        <!-- SUMMARY TILES -->

        <div class="intel-summary-grid">

            <div class="intel-stat">
                <span>Active</span>
                <strong>${formatNumber(workload.active ?? 0)}</strong>
            </div>

            <div class="intel-stat">
                <span>Handled</span>
                <strong>${formatNumber(workload.handled ?? 0)}</strong>
                <small>${Number(workload.handledRate ?? 0).toFixed(1)}% of total</small>
            </div>

            <div class="intel-stat">
                <span>Unassigned</span>
                <strong class="accent-amber">${formatNumber(workload.unassigned ?? 0)}</strong>
                <small>${Number(workload.unassignedRate ?? 0).toFixed(1)}% of total</small>
            </div>

            <div class="intel-stat">
                <span>High-Risk Open</span>
                <strong class="accent-blue">${formatNumber(workload.highRiskOpen ?? 0)}</strong>
            </div>

        </div>


        <!-- WORK STATE -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Work state
            </div>

            ${
                stateEntries.length
                    ? `<div class="intel-bars">${
                        stateEntries.map((item, index) => {

                            const width =
                                Math.max(4, Math.min(100, (item.value / maxState) * 100));

                            return `
                                <div class="intel-bar-row row-anim" style="${rowDelay(index, 35)}">
                                    <span class="intel-bar-label">${escapeHTML(item.label)}</span>
                                    <div class="intel-bar-track">
                                        <div class="intel-bar-fill tone-${item.tone}" style="width:${width}%"></div>
                                    </div>
                                    <span class="intel-bar-value">${formatNumber(item.value)}</span>
                                </div>
                            `;

                        }).join("")
                    }</div>`
                    : `<div class="intel-empty-inline">No open work items.</div>`
            }

        </div>


        <!-- SEVERITY MIX -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Severity mix
            </div>

            ${
                severityEntries.length
                    ? `<div class="intel-bars">${
                        severityEntries.map((item, index) => {

                            const width =
                                Math.max(4, Math.min(100, (item.value / maxSeverity) * 100));

                            return `
                                <div class="intel-bar-row row-anim" style="${rowDelay(index, 35)}">
                                    <span class="intel-bar-label">${escapeHTML(item.label)}</span>
                                    <div class="intel-bar-track">
                                        <div class="intel-bar-fill tone-${item.tone}" style="width:${width}%"></div>
                                    </div>
                                    <span class="intel-bar-value">${formatNumber(item.value)}</span>
                                </div>
                            `;

                        }).join("")
                    }</div>`
                    : `<div class="intel-empty-inline">No severity data available.</div>`
            }

        </div>


        <!-- ANALYST ACTIVITY -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Analyst activity
            </div>

            ${
                analystActivity.length
                    ? `
                        <div class="case-severity-table">

                            <div class="case-severity-header">
                                <span>Analyst</span>
                                <span>Handled</span>
                                <span>Accepted / FP</span>
                            </div>

                            ${
                                analystActivity.map((item, index) => `
                                    <div class="case-severity-row row-anim" style="${rowDelay(index, 35)}">
                                        <span class="case-severity-name" title="${escapeHTML(item.analyst)}">
                                            ${escapeHTML(item.analyst)}
                                        </span>
                                        <span class="case-severity-value">
                                            ${formatNumber(item.handledActions ?? 0)}
                                        </span>
                                        <span class="case-severity-value">
                                            ${formatNumber(item.riskAcceptedActions ?? 0)} / ${formatNumber(item.falsePositiveActions ?? 0)}
                                        </span>
                                    </div>
                                `).join("")
                            }

                        </div>
                    `
                    : `<div class="intel-empty-inline">No analyst activity recorded.</div>`
            }

        </div>


        <!-- SUMMARY FOOTNOTE -->

        <div class="intel-footnote">
            <span>${formatNumber(summary.analysts ?? 0)} analysts</span>
            <strong>${formatNumber(summary.totalHandledActions ?? 0)} handled actions</strong>
        </div>

    `;

    animateFills(container);
}


/*
====================================================
CASE DISPOSITION  (cyeraDispositionIntelligence)
====================================================
Reads data.cyeraDispositionIntelligence and renders
into #disposition-container / #disposition-meta.

NOTE: "Notable alerts" (importantAlerts) used to be
rendered as a subsection inside this same container.
It is now rendered separately by renderHighRiskCases()
into #highrisk-container, so the same data can stand on
its own as the dashboard's "high-risk cases" section
instead of being buried inside a tab. No data changed —
only where it's mounted.
*/

function renderDisposition(data) {

    const container =
        getElement("disposition-container");

    if (!container) {
        return;
    }

    const intel =
        data?.cyeraDispositionIntelligence;

    const meta =
        getElement("disposition-meta");

    if (!intel) {
        container.innerHTML =
            emptyState("No disposition data available.");

        return;
    }

    if (meta) {
        meta.textContent = intel.reportId || "Cyera";
    }

    const disposition =
        intel.disposition || {};

    const highRisk =
        intel.highRiskOutcome || {};

    const analystOutcomes =
        Array.isArray(intel.analystOutcomes)
            ? [...intel.analystOutcomes].sort(
                (a, b) => (b.totalHandled ?? 0) - (a.totalHandled ?? 0)
            )
            : [];

    const dispositionEntries = [
        { label: "Risk accepted", value: Number(disposition.riskAccepted ?? 0), tone: "grey" },
        { label: "False positive", value: Number(disposition.falsePositive ?? 0), tone: "green" },
        { label: "Resolved / closed", value: Number(disposition.resolvedOrClosed ?? 0), tone: "green" },
        { label: "In progress", value: Number(disposition.inProgress ?? 0), tone: "blue" },
        { label: "Open", value: Number(disposition.open ?? 0), tone: "amber" }
    ].filter(item => item.value > 0);

    const maxDisposition =
        Math.max(...dispositionEntries.map(item => item.value), 1);

    container.innerHTML = `

        <!-- HERO: total vs high-risk outcome -->

        <div class="risk-hero">

            <div class="risk-total">
                <span>Total cases</span>
                <strong>${formatNumber(disposition.total ?? 0)}</strong>
            </div>

            <div class="risk-high">
                <span>High / critical</span>
                <strong>${formatNumber(highRisk.total ?? 0)}</strong>
                <small>${formatNumber(highRisk.riskAccepted ?? 0)} accepted &middot; ${formatNumber(highRisk.openUnassigned ?? 0)} unassigned</small>
            </div>

        </div>


        <!-- DISPOSITION BREAKDOWN -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Disposition breakdown
            </div>

            ${
                dispositionEntries.length
                    ? `<div class="intel-bars">${
                        dispositionEntries.map((item, index) => {

                            const width =
                                Math.max(4, Math.min(100, (item.value / maxDisposition) * 100));

                            return `
                                <div class="intel-bar-row row-anim" style="${rowDelay(index, 35)}">
                                    <span class="intel-bar-label">${escapeHTML(item.label)}</span>
                                    <div class="intel-bar-track">
                                        <div class="intel-bar-fill tone-${item.tone}" style="width:${width}%"></div>
                                    </div>
                                    <span class="intel-bar-value">${formatNumber(item.value)}</span>
                                </div>
                            `;

                        }).join("")
                    }</div>`
                    : `<div class="intel-empty-inline">No disposition data available.</div>`
            }

        </div>


        <!-- TOP ANALYSTS -->

        <div class="intel-subsection">

            <div class="intel-subsection-title">
                Top analysts by cases handled
            </div>

            <div class="risk-list">

                ${
                    analystOutcomes.length
                        ? analystOutcomes.slice(0, 5).map((item, index) => `
                            <div class="risk-list-row row-anim" style="${rowDelay(index, 35)}">
                                <div class="risk-list-main">
                                    <span class="risk-list-name" title="${escapeHTML(item.analyst)}">
                                        ${escapeHTML(item.analyst)}
                                    </span>
                                </div>
                                <div class="risk-list-count">
                                    <strong>${formatNumber(item.totalHandled ?? 0)}</strong>
                                    <span>${formatNumber(item.riskAccepted ?? 0)} accepted</span>
                                </div>
                            </div>
                        `).join("")
                        : `<div class="intel-empty-inline">No analyst outcomes recorded.</div>`
                }

            </div>

        </div>

    `;

    animateFills(container);
}


/*
====================================================
HIGH-RISK CASES  (Section 6)
====================================================
Reuses data.cyeraDispositionIntelligence.importantAlerts
— the same "notable alerts" list previously embedded
inside the Case Disposition panel — and renders it into
its own compact, dedicated section so high/critical
cases are surfaced directly rather than buried in a tab.
No new data or calculation, purely a presentation split.
*/

function renderHighRiskCases(data) {

    const container = getElement("highrisk-container");

    if (!container) {
        return;
    }

    const intel = data?.cyeraDispositionIntelligence;

    const importantAlerts =
        Array.isArray(intel?.importantAlerts)
            ? intel.importantAlerts
            : [];

    if (!importantAlerts.length) {
        container.innerHTML =
            emptyState("No high-risk alerts flagged this report.", { icon: "\u2713" });
        return;
    }

    container.innerHTML = `
        <div class="risk-list">
            ${importantAlerts.slice(0, 8).map((item, index) => `
                <div class="risk-list-row row-anim" style="${rowDelay(index, 35)}">
                    <div class="risk-list-main">
                        <div class="queue-name-row">
                            <span class="sev-dot sev-${escapeHTML(String(item.severity || "unknown").toLowerCase())}"></span>
                            <span class="risk-list-name" title="${escapeHTML(item.name)}">
                                ${escapeHTML(item.name)}
                            </span>
                        </div>
                    </div>
                    <div class="risk-list-count">
                        <span class="chip chip-status">${escapeHTML(item.status || "\u2014")}</span>
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    animateFills(container);

}
/*
====================================================
ALERT BREAKDOWN
====================================================
*/

function renderBarGroup(title, entries, toneFn) {

    if (!entries.length) {
        return "";
    }

    const max = Math.max(...entries.map(e => e.value), 1);

    const rows = entries
        .map((entry, index) => {

            const width = Math.max(4, Math.min(100, (entry.value / max) * 100));
            const tone = toneFn ? toneFn(entry.label) : "grey";

            return `
                <div class="bar-row row-anim" style="${rowDelay(index, 40)}">
                    <span class="bar-label" title="${escapeHTML(entry.label)}">${escapeHTML(entry.label)}</span>
                    <div class="bar-track">
                        <div class="bar-fill tone-${tone}" style="width:${width}%;"></div>
                    </div>
                    <span class="bar-value">${formatNumber(entry.value)}</span>
                </div>
            `;

        })
        .join("");

    return `
        <div class="breakdown-group">
            <div class="breakdown-group-title">${escapeHTML(title)}</div>
            ${rows}
        </div>
    `;

}


function objectToEntries(obj) {

    if (!obj || typeof obj !== "object") {
        return [];
    }

    return Object.entries(obj)
        .map(([key, value]) => ({
            label: key,
            value: typeof value === "object" ? (value?.count ?? value?.total ?? 0) : Number(value) || 0
        }))
        .filter(entry => entry.value > 0)
        .sort((a, b) => b.value - a.value);

}


function distributionToEntries(list) {

    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .map(item => ({ label: item.value, value: item.count ?? 0 }))
        .filter(entry => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

}


function renderAlertBreakdown(data) {

    const container = getElement("alert-breakdown");
    const alerts = data?.alerts || {};
    const distributions = data?.securityIntelligence?.distributions || {};

    const severityEntries = objectToEntries(alerts.severity);
    const statusEntries = objectToEntries(alerts.status);
    const channelEntries = distributionToEntries(distributions.channel);
    const policyEntries = distributionToEntries(distributions.policy).map((entry, index) => ({
        label: `Policy ${index + 1}`,
        value: entry.value
    }));

    const html = [
        renderBarGroup("Severity", severityEntries, severityToTone),
        renderBarGroup("Status", statusEntries, statusToTone),
        renderBarGroup("Channel", channelEntries, () => "blue"),
        renderBarGroup("Policy Volume", policyEntries, () => "grey")
    ].join("");

    container.innerHTML = html || emptyState("No breakdown data available.");

    animateFills(container);

}


/*
====================================================
LATEST REPORT
====================================================
*/

function renderReport(data) {

    const container = getElement("report-container");
    const report = data?.report;

    if (!report) {
        container.innerHTML = emptyState("No report information available.");
        return;
    }

    container.innerHTML = `

        <div class="report-grid">

            <div class="report-item">
                <span>Report ID</span>
                <strong>${escapeHTML(report.reportId ?? "\u2014")}</strong>
            </div>

            <div class="report-item">
                <span>Report Date</span>
                <strong>${formatReportDate(report.reportDate)}</strong>
            </div>

            <div class="report-item" style="grid-column: 1 / -1;">
                <span>Generated</span>
                <strong>${formatDate(report.generatedAt)}</strong>
            </div>

        </div>

    `;

}


/*
====================================================
GENERATED TIME
====================================================
*/

function renderGeneratedAt(data) {

    const container = getElement("generated-container");
    const generatedAt = data?.generatedAt;

    if (!generatedAt) {
        container.innerHTML = `
            <div class="status-footer-dot" style="background:var(--text-tertiary); box-shadow:none;"></div>
            <div class="status-footer-text">
                <strong>Intelligence timestamp unavailable</strong>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="status-footer-dot"></div>
        <div class="status-footer-text">
            <strong>Intelligence generated</strong>
            <span>${formatDate(generatedAt)}</span>
        </div>
    `;

}


/*
====================================================
VISUAL ANALYTICS — CHART.JS PANEL
====================================================
Draws four charts from the same `data` object every other
render function already uses:

  1. Severity donut  — data.alerts.severity
  2. Status donut    — data.alerts.status
  3. Comparison bars — data.comparison (current vs previous)
  4. Lifecycle donut — data.lifecycle (new vs carried over)

Chart instances are cached on `window.__intelCharts` and
destroyed/recreated on every refresh so repeated calls to
loadIntelligence() don't leak canvases or stack tooltips.
Purely additive — no existing render function or DOM id is
touched, and if data for a given chart is missing the card
just shows a quiet empty state instead of throwing.

Visual language matches the rest of the dashboard: donuts
carry a center readout (total + label) instead of relying
on an external legend to convey scale, every card gets a
one-line, data-driven caption under its title, and bars use
a subtle vertical gradient rather than a flat fill so the
"Visual Analytics" panel reads as a first-class section
instead of a bolted-on afterthought.
====================================================
*/

window.__intelCharts = window.__intelCharts || {};

const CHART_THEME = {
    tooltipBg: "#161f2b",
    tooltipBorder: "#2e3a49",
    gridLine: "rgba(141, 153, 170, 0.08)"
};

function destroyChart(key) {

    const existing = window.__intelCharts[key];

    if (existing) {
        existing.destroy();
        delete window.__intelCharts[key];
    }

}


function chartEmptyState(canvasId, message) {

    const canvas = getElement(canvasId);

    if (!canvas || !canvas.parentElement) {
        return;
    }

    destroyChart(canvasId);
    canvas.style.display = "none";

    let note = canvas.parentElement.querySelector(".chart-empty-note");

    if (!note) {
        note = document.createElement("div");
        note.className = "chart-empty-note empty-state";
        note.style.cssText = "padding:0; min-height:150px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;";
        canvas.parentElement.appendChild(note);
    }

    note.innerHTML = `<div class="empty-icon">\u25CB</div>${escapeHTML(message)}`;

}


function clearChartEmptyState(canvasId) {

    const canvas = getElement(canvasId);

    if (!canvas) {
        return;
    }

    canvas.style.display = "";

    const note = canvas.parentElement?.querySelector(".chart-empty-note");

    if (note) {
        note.remove();
    }

}


// Small one-line caption rendered under a chart's title, e.g.
// "1,204 total  ·  62% high or critical". Purely descriptive —
// mirrors panel-meta styling already used elsewhere on the page.
function setChartCaption(cardSelector, text) {

    const card = document.querySelector(cardSelector);

    if (!card) {
        return;
    }

    let caption = card.querySelector(".chart-caption");

    if (!caption) {
        caption = document.createElement("div");
        caption.className = "chart-caption";
        const title = card.querySelector(".chart-card-title");
        if (title) {
            title.insertAdjacentElement("afterend", caption);
        } else {
            card.prepend(caption);
        }
    }

    caption.textContent = text || "";
    caption.style.display = text ? "" : "none";

}


function renderLegend(elementId, entries) {

    const el = getElement(elementId);

    if (!el) {
        return;
    }

    if (!entries.length) {
        el.innerHTML = "";
        return;
    }

    const total = entries.reduce((sum, e) => sum + Number(e.value || 0), 0);

    el.innerHTML = entries.map(entry => {

        const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;

        return `
            <span class="chart-legend-item">
                <span class="chart-legend-swatch" style="background:${entry.color}"></span>
                ${escapeHTML(entry.label)}
                <strong>${formatNumber(entry.value)}</strong>
                <span style="opacity:.55;">${pct}%</span>
            </span>
        `;

    }).join("");

}


// Shared Chart.js plugin: draws a total count + label in the
// donut's empty center, so the ring itself doubles as a KPI
// readout instead of needing a separate number elsewhere.
const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart, args, opts) {

        if (!opts || !opts.display) {
            return;
        }

        const { ctx, chartArea } = chart;
        const x = (chartArea.left + chartArea.right) / 2;
        const y = (chartArea.top + chartArea.bottom) / 2;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.font = "700 22px 'Space Grotesk', 'IBM Plex Mono', monospace";
        ctx.fillStyle = CHART_COLORS.textPrimary;
        ctx.fillText(formatNumber(opts.value), x, y - 6);

        ctx.font = "600 9px 'IBM Plex Mono', monospace";
        ctx.fillStyle = CHART_COLORS.textTertiary;
        ctx.fillText((opts.label || "TOTAL").toUpperCase(), x, y + 15);

        ctx.restore();

    }
};

const chartTooltipBase = {
    backgroundColor: CHART_THEME.tooltipBg,
    borderColor: CHART_THEME.tooltipBorder,
    borderWidth: 1,
    cornerRadius: 8,
    padding: 10,
    titleColor: CHART_COLORS.textPrimary,
    bodyColor: CHART_COLORS.textSecondary,
    titleFont: { size: 11.5, weight: "600" },
    bodyFont: { size: 11.5 },
    boxPadding: 4
};


function renderDonutChart(canvasId, legendId, entries, options = {}) {

    if (!window.Chart) {
        return;
    }

    const canvas = getElement(canvasId);

    if (!canvas) {
        return;
    }

    destroyChart(canvasId);

    if (!entries.length) {
        chartEmptyState(canvasId, options.emptyMessage || "No data available.");
        renderLegend(legendId, []);
        if (options.captionSelector) setChartCaption(options.captionSelector, "");
        return;
    }

    clearChartEmptyState(canvasId);

    const total = entries.reduce((sum, e) => sum + Number(e.value || 0), 0);

    window.__intelCharts[canvasId] = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
            labels: entries.map(e => e.label),
            datasets: [{
                data: entries.map(e => e.value),
                backgroundColor: entries.map(e => e.color),
                borderColor: CHART_COLORS.panelBg,
                borderWidth: 3,
                hoverBorderWidth: 3,
                hoverOffset: 6,
                spacing: 2
            }]
        },
        plugins: [centerTextPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "70%",
            animation: { duration: 550, easing: "easeOutQuart" },
            interaction: { intersect: false, mode: "nearest" },
            plugins: {
                legend: { display: false },
                centerText: { display: true, value: total, label: options.centerLabel || "total" },
                tooltip: {
                    ...chartTooltipBase,
                    callbacks: {
                        label: (ctx) => {
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0.0";
                            return ` ${ctx.label}: ${formatNumber(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    renderLegend(legendId, entries.map(e => ({ label: e.label, value: e.value, color: e.color })));

    if (options.captionSelector && typeof options.caption === "function") {
        setChartCaption(options.captionSelector, options.caption(entries, total));
    }

}


function renderComparisonChart(data) {

    const canvasId = "chart-comparison";
    const canvas = getElement(canvasId);
    const captionSelector = "#chart-comparison-card";

    if (!canvas || !window.Chart) {
        return;
    }

    destroyChart(canvasId);

    const comparison = data?.comparison;

    if (!comparison) {
        chartEmptyState(canvasId, "No comparison data available.");
        setChartCaption(captionSelector, "");
        return;
    }

    const currentReport = comparison.currentReport || {};
    const previousReport = comparison.previousReport || {};
    const change = comparison.change || {};

    const labels = ["Total Alerts", "Cyera", "Purview"];
    const current = [
        currentReport.totalAlerts ?? comparison.current ?? 0,
        currentReport.cyera ?? 0,
        currentReport.purview ?? 0
    ];
    const previous = [
        previousReport.totalAlerts ?? comparison.previous ?? 0,
        previousReport.cyera ?? 0,
        previousReport.purview ?? 0
    ];

    if (!current.some(v => v > 0) && !previous.some(v => v > 0)) {
        chartEmptyState(canvasId, "No comparison data available.");
        setChartCaption(captionSelector, "");
        return;
    }

    clearChartEmptyState(canvasId);

    const ctx = canvas.getContext("2d");

    const currentGradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
    currentGradient.addColorStop(0, CHART_COLORS.blue);
    currentGradient.addColorStop(1, "rgba(91, 157, 249, 0.35)");

    window.__intelCharts[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Previous",
                    data: previous,
                    backgroundColor: "rgba(141, 153, 170, 0.28)",
                    borderColor: "rgba(141, 153, 170, 0.5)",
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 30
                },
                {
                    label: "Current",
                    data: current,
                    backgroundColor: currentGradient,
                    borderColor: CHART_COLORS.blue,
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 30
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 550, easing: "easeOutQuart" },
            interaction: { intersect: false, mode: "index" },
            scales: {
                x: {
                    border: { display: false },
                    ticks: { color: CHART_COLORS.textSecondary, font: { size: 10.5 } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    ticks: { color: CHART_COLORS.textTertiary, font: { size: 10 } },
                    grid: { color: CHART_THEME.gridLine, drawTicks: false }
                }
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: CHART_COLORS.textSecondary,
                        usePointStyle: true,
                        pointStyle: "circle",
                        boxWidth: 7,
                        boxHeight: 7,
                        padding: 16,
                        font: { size: 10.5 }
                    }
                },
                tooltip: {
                    ...chartTooltipBase,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`
                    }
                }
            }
        }
    });

    const totalChange = Number(change.totalAlerts ?? 0);
    const totalPct = Number(change.totalPercentage ?? 0);
    const captionText = totalChange === 0
        ? "Total alerts unchanged vs previous report"
        : `Total alerts ${totalChange > 0 ? "up" : "down"} ${formatNumber(Math.abs(totalChange))} (${Math.abs(totalPct).toFixed(1)}%) vs previous report`;

    setChartCaption(captionSelector, captionText);

}


function renderLifecycleChart(data) {

    const canvasId = "chart-lifecycle";
    const canvas = getElement(canvasId);
    const captionSelector = "#chart-lifecycle-card";

    if (!canvas || !window.Chart) {
        return;
    }

    destroyChart(canvasId);

    const lifecycle = data?.lifecycle;

    if (!lifecycle) {
        chartEmptyState(canvasId, "No lifecycle data available.");
        setChartCaption(captionSelector, "");
        return;
    }

    const newAlerts = Number(lifecycle.new ?? 0);
    const carriedOver = Number(lifecycle.carriedOver ?? 0);

    if (newAlerts <= 0 && carriedOver <= 0) {
        chartEmptyState(canvasId, "No lifecycle data available.");
        setChartCaption(captionSelector, "");
        return;
    }

    clearChartEmptyState(canvasId);

    const total = newAlerts + carriedOver;
    const carriedPct = total > 0 ? (carriedOver / total) * 100 : 0;

    window.__intelCharts[canvasId] = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
            labels: ["New this report", "Carried over"],
            datasets: [{
                data: [newAlerts, carriedOver],
                backgroundColor: [CHART_COLORS.blue, CHART_COLORS.textTertiary],
                borderColor: CHART_COLORS.panelBg,
                borderWidth: 3,
                hoverBorderWidth: 3,
                hoverOffset: 6,
                spacing: 2
            }]
        },
        plugins: [centerTextPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "70%",
            animation: { duration: 550, easing: "easeOutQuart" },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: CHART_COLORS.textSecondary,
                        usePointStyle: true,
                        pointStyle: "circle",
                        boxWidth: 7,
                        boxHeight: 7,
                        padding: 16,
                        font: { size: 10.5 }
                    }
                },
                centerText: { display: true, value: total, label: "total" },
                tooltip: {
                    ...chartTooltipBase,
                    callbacks: {
                        label: (ctx) => {
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0.0";
                            return ` ${ctx.label}: ${formatNumber(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    setChartCaption(
        captionSelector,
        `${formatPercentage(carriedPct)} of open alerts are carried over from a prior report`
    );

}


function renderCharts(data) {

    if (!window.Chart) {
        // Chart.js failed to load (e.g. CDN blocked) — leave the
        // canvases as quiet empty states rather than erroring.
        ["chart-severity", "chart-status", "chart-comparison", "chart-lifecycle"].forEach(id => {
            chartEmptyState(id, "Chart library unavailable.");
        });
        return;
    }

    const alerts = data?.alerts || {};

    const severityEntries = objectToEntries(alerts.severity)
        .map(e => ({ ...e, color: chartToneColor(severityToTone(e.label)) }));

    const statusEntries = objectToEntries(alerts.status)
        .map(e => ({ ...e, color: chartToneColor(statusToTone(e.label)) }));

    renderDonutChart("chart-severity", "chart-severity-legend", severityEntries, {
        emptyMessage: "No severity data available.",
        centerLabel: "alerts",
        captionSelector: "#chart-severity-card",
        caption: (entries, total) => {
            const highRisk = entries
                .filter(e => e.label.toLowerCase() === "critical" || e.label.toLowerCase() === "high")
                .reduce((s, e) => s + e.value, 0);
            const pct = total > 0 ? (highRisk / total) * 100 : 0;
            return `${formatPercentage(pct)} rated high or critical severity`;
        }
    });

    renderDonutChart("chart-status", "chart-status-legend", statusEntries, {
        emptyMessage: "No status data available.",
        centerLabel: "alerts",
        captionSelector: "#chart-status-card",
        caption: (entries, total) => {
            const open = entries
                .filter(e => ["open", "active", "investigating"].includes(e.label.toLowerCase()))
                .reduce((s, e) => s + e.value, 0);
            const pct = total > 0 ? (open / total) * 100 : 0;
            return `${formatPercentage(pct)} still open or in progress`;
        }
    });

    renderComparisonChart(data);
    renderLifecycleChart(data);

}


/*
====================================================
ERROR STATE
====================================================
*/

function showPageError(message) {

    const containers = [
        "insights-container",
        "queue-container",
        "comparison-container",
        "lifecycle-container",
        "case-outcome-container",
        "risk-acceptance-container",
        "operational-intelligence-container",
        "workload-container",
        "disposition-container",
        "highrisk-container",
        "alert-breakdown",
        "report-container"
    ];

    containers.forEach(id => {

        const element = getElement(id);

        if (!element) {
            return;
        }

        element.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">\u26A0</div>
                Unable to load intelligence.
                <small>${escapeHTML(message)}</small>
                <div style="margin-top:12px;">
                    <button class="btn-refresh" style="display:inline-flex; padding:7px 12px; font-size:12px;" onclick="loadIntelligence()">Try again</button>
                </div>
            </div>
        `;

    });

    ["chart-severity", "chart-status", "chart-comparison", "chart-lifecycle"].forEach(id => {
        destroyChart(id);
        chartEmptyState(id, "Unable to load intelligence.");
    });

    const toggle = getElement("findings-toggle");
    if (toggle) toggle.style.display = "none";

}


/*
====================================================
PDF EXPORT — MANAGEMENT INTELLIGENCE REPORT
====================================================
Turns the currently loaded intelligence payload into a
short, executive-readable PDF: what happened, what's
risky right now, and what needs a decision. This section
does not touch any of the rendering logic above — it only
reads the same `data` shape that already powers the page.

jsPDF is loaded lazily from a CDN the first time someone
clicks "Export PDF", so normal page load isn't slowed down
by a library most visits won't use.
====================================================
*/

let jsPDFLoadPromise = null;

function loadJsPDF() {

    if (window.jspdf && window.jspdf.jsPDF) {
        return Promise.resolve(window.jspdf.jsPDF);
    }

    if (jsPDFLoadPromise) {
        return jsPDFLoadPromise;
    }

    jsPDFLoadPromise = new Promise((resolve, reject) => {

        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        script.async = true;

        script.onload = () => {
            if (window.jspdf && window.jspdf.jsPDF) {
                resolve(window.jspdf.jsPDF);
            } else {
                reject(new Error("PDF library failed to initialize."));
            }
        };

        script.onerror = () => {
            jsPDFLoadPromise = null;
            reject(new Error("Could not load the PDF library. Check your connection and try again."));
        };

        document.head.appendChild(script);

    });

    return jsPDFLoadPromise;

}


/*
----------------------------------------------------
SMALL FORMAT HELPERS (PDF-scoped, do not touch the
existing formatNumber/formatPercentage used by the
live dashboard — these are deliberately separate so
PDF text stays plain and printable).
----------------------------------------------------
*/

function pdfNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function pdfPct(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "0%";
}


/*
----------------------------------------------------
EXECUTIVE SUMMARY BUILDER

Turns the raw payload into a handful of plain-English
sentences plus a coarse "posture" reading (stable /
elevated / needs immediate attention), so the reader
doesn't have to interpret numbers themselves.
----------------------------------------------------
*/

function buildExecutiveSummary(data) {

    const alerts = data?.alerts || {};
    const change = data?.comparison?.change || {};
    const secIntel = data?.securityIntelligence || {};
    const caseOutcome = data?.caseOutcome || secIntel?.caseOutcome || {};
    const riskAcceptance = data?.riskAcceptance || secIntel?.riskAcceptance || {};
    const cyera = data?.cyeraOperationalIntelligence || {};

    const total = alerts.total ?? data?.totalAlerts ?? 0;
    const highRisk = secIntel?.risk?.highOrCritical ?? 0;
    const unassigned = alerts.unassigned ?? 0;
    const highRiskUnassigned = cyera?.currentState?.highRiskUnassigned ?? 0;
    const totalChange = Number(change.totalAlerts ?? 0);
    const dispositionRate = caseOutcome?.disposition?.rate ?? 0;
    const riskAcceptedRate = riskAcceptance?.rate ?? caseOutcome?.riskAcceptance?.rate ?? 0;
    const avgAcceptanceAge = riskAcceptance?.aging?.averageDays ?? 0;

    const trendWord = totalChange > 0 ? "increased" : totalChange < 0 ? "decreased" : "held steady";
    const changeClause = totalChange !== 0
        ? ` by ${pdfNum(Math.abs(totalChange))} (${pdfPct(Math.abs(change.totalPercentage ?? 0))})`
        : "";

    const lines = [
        `Alert volume this period is ${pdfNum(total)}, which has ${trendWord}${changeClause} compared with the prior report.`,
        `${pdfNum(highRisk)} alerts are currently rated high or critical severity, and ${pdfNum(highRiskUnassigned)} of those have no assigned owner \u2014 this is the single biggest exposure to watch.`,
        `${pdfNum(unassigned)} alerts overall remain unassigned. ${pdfPct(dispositionRate)} of cases have reached a final disposition so far this period.`,
        `${pdfPct(riskAcceptedRate)} of dispositioned cases were closed via risk acceptance rather than remediation, with an average acceptance age of ${Number(avgAcceptanceAge).toFixed(0)} days.`
    ];

    let posture = "Stable";
    if (highRiskUnassigned > 0) posture = "Needs immediate attention";
    else if (highRisk > 0) posture = "Elevated \u2014 monitor closely";

    return { lines, posture, total, highRisk, highRiskUnassigned, unassigned };

}


/*
----------------------------------------------------
RECOMMENDATIONS BUILDER

Simple, explainable thresholds rather than a black box:
unowned high-risk alerts, a high unassigned rate, and
stale risk acceptances are always worth a management
callout. Falls back to the report's own recommended
actions for its top findings.
----------------------------------------------------
*/

function buildRecommendations(data) {

    const recs = [];
    const secIntel = data?.securityIntelligence || {};
    const cyera = data?.cyeraOperationalIntelligence || {};
    const riskAcceptance = data?.riskAcceptance || secIntel?.riskAcceptance || {};
    const insights = Array.isArray(data?.insights) ? data.insights : [];

    const highRiskUnassigned = cyera?.currentState?.highRiskUnassigned ?? 0;
    const unassignedRate = cyera?.currentState?.unassignedRate ?? 0;
    const over90 = riskAcceptance?.aging?.over90Days ?? 0;

    if (highRiskUnassigned > 0) {
        recs.push(`Assign an owner to the ${pdfNum(highRiskUnassigned)} unassigned high/critical alert(s) this week \u2014 these are the highest-risk open items on the board.`);
    }

    if (Number(unassignedRate) > 20) {
        recs.push(`Unassigned alerts make up ${pdfPct(unassignedRate)} of the active queue. Consider rebalancing analyst workload or reviewing intake triage.`);
    }

    if (Number(over90) > 0) {
        recs.push(`${pdfNum(over90)} risk-accepted item(s) are over 90 days old. Schedule a review to confirm each acceptance still holds.`);
    }

    insights
        .filter(item => {
            const p = String(item.priority || "").toLowerCase();
            return p === "critical" || p === "high";
        })
        .slice(0, 3)
        .forEach(item => {
            if (item.recommendedAction) {
                recs.push(item.recommendedAction);
            }
        });

    if (!recs.length) {
        recs.push("No urgent action items identified this period \u2014 continue routine monitoring.");
    }

    return recs;

}


/*
----------------------------------------------------
RISK INDEX

A single, explainable 0-100 score for management to
track period over period, instead of having to weigh
a dozen separate metrics themselves. Every component is
disclosed (weight + plain-English note) so it never reads
as a black box \u2014 the score is a sum, not a model.

Weighting rationale:
  - Unowned high/critical alerts (30%): the most direct
    measure of exposure sitting with nobody responsible.
  - Overall unassigned rate (20%): a leading indicator of
    triage/staffing strain.
  - High-risk closed via acceptance rather than fixed (15%):
    signals risk being tolerated instead of remediated.
  - Stale risk acceptances 90d+ (15%): acceptances that were
    never revisited are a governance gap.
  - Alert volume growth (10%): rising inflow raises future risk
    even if today's numbers look fine.
  - Backlog carried over (10%): whether the team is keeping
    pace with new alerts.
----------------------------------------------------
*/

function computeRiskIndex(data) {

    const secIntel = data?.securityIntelligence || {};
    const cyera = data?.cyeraOperationalIntelligence || {};
    const currentState = cyera?.currentState || {};
    const riskAcceptance = data?.riskAcceptance || secIntel?.riskAcceptance || {};

    const highRisk = Number(secIntel?.risk?.highOrCritical ?? 0);
    const highRiskUnassigned = Number(currentState.highRiskUnassigned ?? 0);
    const unassignedRate = Number(currentState.unassignedRate ?? 0);
    const highRiskAcceptanceRate = Number(riskAcceptance?.highRisk?.rate ?? 0);
    const totalAccepted = Number(riskAcceptance?.totalRiskAccepted ?? 0);
    const over90 = Number(riskAcceptance?.aging?.over90Days ?? 0);
    const stalePct = totalAccepted > 0 ? (over90 / totalAccepted) * 100 : 0;
    const changePct = Number(data?.comparison?.change?.totalPercentage ?? 0);
    const growthComponent = Math.max(0, changePct);
    const carriedOverPct = Number(data?.lifecycle?.carriedOverPercentage ?? 0);
    const unownedHighRiskRate = highRisk > 0 ? (highRiskUnassigned / highRisk) * 100 : 0;

    const components = [
        {
            label: "Unowned high/critical alerts",
            value: unownedHighRiskRate,
            weight: 0.30,
            note: `${pdfNum(highRiskUnassigned)} of ${pdfNum(highRisk)} high/critical alerts (${pdfPct(unownedHighRiskRate)}) have no assigned owner.`
        },
        {
            label: "Overall unassigned rate",
            value: unassignedRate,
            weight: 0.20,
            note: `${pdfPct(unassignedRate)} of the active alert queue is unassigned.`
        },
        {
            label: "High-risk closed via acceptance",
            value: highRiskAcceptanceRate,
            weight: 0.15,
            note: `${pdfPct(highRiskAcceptanceRate)} of high/critical alerts were closed by accepting the risk rather than remediating it.`
        },
        {
            label: "Stale risk acceptances (90d+)",
            value: stalePct,
            weight: 0.15,
            note: `${pdfNum(over90)} of ${pdfNum(totalAccepted)} accepted-risk items (${pdfPct(stalePct)}) are over 90 days old and due for re-review.`
        },
        {
            label: "Alert volume growth",
            value: Math.min(growthComponent, 100),
            weight: 0.10,
            note: changePct > 0
                ? `Alert volume grew ${pdfPct(changePct)} versus the prior report.`
                : `Alert volume did not grow versus the prior report.`
        },
        {
            label: "Backlog carried over",
            value: carriedOverPct,
            weight: 0.10,
            note: `${pdfPct(carriedOverPct)} of current alerts were carried over rather than newly opened this period.`
        }
    ];

    const score = components.reduce(
        (sum, c) => sum + (Math.max(0, Math.min(100, c.value)) * c.weight),
        0
    );

    let band = "Low";
    let tone = "green";

    if (score >= 66) {
        band = "High";
        tone = "red";
    } else if (score >= 33) {
        band = "Moderate";
        tone = "amber";
    }

    const drivers = [...components]
        .sort((a, b) => (b.value * b.weight) - (a.value * a.weight))
        .slice(0, 3)
        .map(c => c.note);

    return { score, band, tone, components, drivers };

}


/*
----------------------------------------------------
TREND & VELOCITY

Answers a question raw counts don't: is the team keeping
pace with new alerts, or is the backlog quietly growing?
----------------------------------------------------
*/

function buildVelocityInsight(data) {

    const lifecycle = data?.lifecycle || {};
    const change = data?.comparison?.change || {};

    const total = Number(lifecycle.currentAlerts ?? lifecycle.total ?? 0);
    const newAlerts = Number(lifecycle.new ?? 0);
    const carried = Number(lifecycle.carriedOver ?? 0);

    const newPct = Number(lifecycle.newPercentage ?? (total ? (newAlerts / total) * 100 : 0));
    const carriedPct = Number(lifecycle.carriedOverPercentage ?? (total ? (carried / total) * 100 : 0));
    const totalChange = Number(change.totalAlerts ?? 0);

    const pace = carriedPct > 55
        ? "the queue is growing faster than the team is closing it \u2014 backlog is building up"
        : carriedPct > 35
        ? "the team is roughly keeping pace, but a meaningful backlog persists"
        : "the team is keeping pace with new alerts and backlog is not accumulating";

    return `Of the ${pdfNum(total)} alerts currently tracked, ${pdfNum(newAlerts)} (${pdfPct(newPct)}) are new this reporting period and ${pdfNum(carried)} (${pdfPct(carriedPct)}) were carried over from before. In plain terms, ${pace}. Total alert volume has ${totalChange > 0 ? "risen" : totalChange < 0 ? "fallen" : "stayed flat"} since the last report.`;

}


/*
----------------------------------------------------
CONCENTRATION & GOVERNANCE

Surfaces whether "resolved" risk is actually clustered
around one recurring issue or one approver \u2014 a pattern
that looks fine in aggregate but hides a systemic problem.
----------------------------------------------------
*/

function buildConcentrationInsight(data) {

    const secIntel = data?.securityIntelligence || {};
    const riskAcceptance = data?.riskAcceptance || secIntel?.riskAcceptance || {};
    const concentration = riskAcceptance?.concentration || {};

    const topPatterns = Array.isArray(concentration.topAlertPatterns) ? concentration.topAlertPatterns : [];
    const topOwners = Array.isArray(concentration.topOwners) ? concentration.topOwners : [];
    const totalAccepted = Number(riskAcceptance?.totalRiskAccepted ?? 0);

    const lines = [];

    if (topPatterns.length && totalAccepted > 0) {

        const top = topPatterns[0];
        const rate = Number(top.rate ?? (totalAccepted ? (top.count / totalAccepted) * 100 : 0));

        lines.push(
            `The single largest driver of accepted risk is "${top.name}", accounting for ${pdfNum(top.count)} acceptance(s) (${pdfPct(rate)} of all accepted risk).` +
            (rate > 30
                ? " That concentration suggests a systemic issue worth fixing at the source rather than accepting repeatedly."
                : " This is a moderate concentration and worth periodic review.")
        );

    }

    if (topOwners.length && totalAccepted > 0) {

        const top = topOwners[0];
        const rate = Number(top.rate ?? (totalAccepted ? (top.count / totalAccepted) * 100 : 0));

        lines.push(
            `${top.name} owns the most risk acceptances (${pdfNum(top.count)}, ${pdfPct(rate)} of the total).` +
            (rate > 40 ? " That level of concentration on one approver is worth a second opinion before further acceptances go through." : "")
        );

    }

    if (!lines.length) {
        lines.push("No significant concentration in risk-acceptance patterns or owners was detected this period.");
    }

    return lines;

}


/*
----------------------------------------------------
TEAM CAPACITY

Flags a "bus factor" risk: work concentrated on a single
analyst is a resilience problem even when throughput
looks healthy in aggregate.
----------------------------------------------------
*/

function buildCapacityInsight(data) {

    const work = data?.cyeraWorkIntelligence || {};
    const activity = Array.isArray(work.analystActivity) ? [...work.analystActivity] : [];
    const summary = work.analystActivitySummary || {};

    const totalHandled = Number(
        summary.totalHandledActions ?? activity.reduce((sum, a) => sum + (a.handledActions || 0), 0)
    );

    if (!activity.length || !totalHandled) {
        return "No analyst activity data available for this period to assess team capacity.";
    }

    const sorted = [...activity].sort((a, b) => (b.handledActions ?? 0) - (a.handledActions ?? 0));
    const top = sorted[0];
    const topShare = totalHandled ? (Number(top.handledActions || 0) / totalHandled) * 100 : 0;
    const analystCount = summary.analysts ?? activity.length;

    let note = `${pdfNum(analystCount)} analyst(s) handled ${pdfNum(totalHandled)} action(s) this period. ${top.analyst || "The top analyst"} alone accounted for ${pdfPct(topShare)} of all handled actions.`;

    if (topShare > 50) {
        note += " Work is heavily concentrated on a single analyst \u2014 this is a capacity risk if that person is unavailable.";
    } else if (topShare > 35) {
        note += " Workload is somewhat concentrated; worth keeping an eye on distribution.";
    } else {
        note += " Workload appears reasonably distributed across the team.";
    }

    return note;

}


/*
----------------------------------------------------
DECISIONS REQUIRING SIGN-OFF

Deliberately separate from "Recommended Actions": these
are the items that specifically need a manager's yes/no
or resourcing call, not an analyst's next task.
----------------------------------------------------
*/

function buildDecisionsNeeded(data) {

    const decisions = [];
    const secIntel = data?.securityIntelligence || {};
    const cyera = data?.cyeraOperationalIntelligence || {};
    const riskAcceptance = data?.riskAcceptance || secIntel?.riskAcceptance || {};
    const currentState = cyera?.currentState || {};

    const highRiskUnassigned = Number(currentState.highRiskUnassigned ?? 0);
    const over90 = Number(riskAcceptance?.aging?.over90Days ?? 0);
    const highRiskAcceptedRate = Number(riskAcceptance?.highRisk?.rate ?? 0);
    const unassignedRate = Number(currentState.unassignedRate ?? 0);

    if (highRiskUnassigned > 0) {
        decisions.push(`Confirm ownership: who is picking up the ${pdfNum(highRiskUnassigned)} unassigned high/critical alert(s), and by when?`);
    }

    if (over90 > 0) {
        decisions.push(`Re-approve or reverse: ${pdfNum(over90)} risk acceptance(s) are over 90 days old and need a documented re-approval or a remediation plan.`);
    }

    if (highRiskAcceptedRate > 25) {
        decisions.push(`Policy check: ${pdfPct(highRiskAcceptedRate)} of high/critical alerts are being closed by risk acceptance rather than remediation \u2014 confirm this is intentional and within risk appetite.`);
    }

    if (unassignedRate > 25) {
        decisions.push(`Staffing: an unassigned rate of ${pdfPct(unassignedRate)} may indicate the team needs more capacity or a triage process change.`);
    }

    if (!decisions.length) {
        decisions.push("No items require executive sign-off this period.");
    }

    return decisions;

}


/*
----------------------------------------------------
PDF LAYOUT PRIMITIVES

Deliberately simple (no table plugin dependency): a
page-break-aware cursor, section headers, wrapped
paragraphs, bullet lists, a metric strip, and a plain
column table. Everything is greyscale-friendly so it
still reads fine printed in black and white.
----------------------------------------------------
*/

const PDF_MARGIN = 48;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

const PDF_COLORS = {
    text: [30, 32, 38],
    muted: [110, 116, 128],
    accentRed: [190, 45, 45],
    accentAmber: [170, 115, 15],
    accentGreen: [30, 135, 90],
    accentBlue: [40, 100, 185],
    line: [222, 226, 232]
};

function pdfToneColor(tone) {
    if (tone === "red") return PDF_COLORS.accentRed;
    if (tone === "amber") return PDF_COLORS.accentAmber;
    if (tone === "green") return PDF_COLORS.accentGreen;
    if (tone === "blue") return PDF_COLORS.accentBlue;
    return PDF_COLORS.text;
}

function pdfEnsureSpace(doc, y, needed) {
    if (y + needed > PDF_PAGE_HEIGHT - PDF_MARGIN) {
        doc.addPage();
        return PDF_MARGIN;
    }
    return y;
}

function pdfSectionTitle(doc, y, title) {
    y = pdfEnsureSpace(doc, y, 34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...PDF_COLORS.text);
    doc.text(title, PDF_MARGIN, y);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.setLineWidth(0.75);
    doc.line(PDF_MARGIN, y + 6, PDF_PAGE_WIDTH - PDF_MARGIN, y + 6);
    return y + 22;
}

function pdfParagraph(doc, y, text, options = {}) {

    const fontSize = options.fontSize || 10;
    const color = options.color || PDF_COLORS.text;
    const lineHeight = options.lineHeight || fontSize * 1.35;
    const indent = options.indent || 0;

    doc.setFont("helvetica", options.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);

    const lines = doc.splitTextToSize(String(text || ""), PDF_CONTENT_WIDTH - indent);

    lines.forEach(line => {
        y = pdfEnsureSpace(doc, y, lineHeight);
        doc.text(line, PDF_MARGIN + indent, y);
        y += lineHeight;
    });

    return y;

}

function pdfBulletList(doc, y, items, options = {}) {

    const fontSize = options.fontSize || 10;

    items.forEach(item => {

        doc.setFont("helvetica", "normal");
        doc.setFontSize(fontSize);
        doc.setTextColor(...PDF_COLORS.text);

        const lines = doc.splitTextToSize(String(item || ""), PDF_CONTENT_WIDTH - 14);

        y = pdfEnsureSpace(doc, y, fontSize * 1.4);
        doc.text("\u2022", PDF_MARGIN, y);

        lines.forEach((line, i) => {
            if (i > 0) {
                y = pdfEnsureSpace(doc, y, fontSize * 1.4);
            }
            doc.text(line, PDF_MARGIN + 14, y);
            y += fontSize * 1.4;
        });

        y += 4;

    });

    return y;

}

function pdfMetricRow(doc, y, metrics) {

    y = pdfEnsureSpace(doc, y, 48);

    const colWidth = PDF_CONTENT_WIDTH / metrics.length;

    metrics.forEach((m, i) => {

        const x = PDF_MARGIN + colWidth * i;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF_COLORS.muted);
        doc.text(m.label.toUpperCase(), x, y);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(17);
        doc.setTextColor(...pdfToneColor(m.tone));
        doc.text(String(m.value), x, y + 19);

    });

    return y + 42;

}

function pdfGaugeBar(doc, y, label, scoreOutOf100, tone) {

    y = pdfEnsureSpace(doc, y, 40);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_COLORS.text);
    doc.text(label, PDF_MARGIN, y);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...pdfToneColor(tone));
    doc.text(`${Math.round(scoreOutOf100)} / 100`, PDF_PAGE_WIDTH - PDF_MARGIN - 42, y);

    y += 8;

    const barWidth = PDF_CONTENT_WIDTH;
    const barHeight = 8;
    const clamped = Math.max(0, Math.min(100, scoreOutOf100));

    doc.setFillColor(233, 236, 240);
    doc.rect(PDF_MARGIN, y, barWidth, barHeight, "F");

    doc.setFillColor(...pdfToneColor(tone));
    doc.rect(PDF_MARGIN, y, barWidth * (clamped / 100), barHeight, "F");

    return y + barHeight + 16;

}

function pdfTable(doc, y, headers, rows, colWidths) {

    y = pdfEnsureSpace(doc, y, 26);

    let x = PDF_MARGIN;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.muted);

    headers.forEach((h, i) => {
        doc.text(h, x, y);
        x += colWidths[i];
    });

    y += 6;
    doc.setDrawColor(...PDF_COLORS.line);
    doc.setLineWidth(0.5);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    y += 14;

    rows.forEach(row => {

        y = pdfEnsureSpace(doc, y, 16);

        x = PDF_MARGIN;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...PDF_COLORS.text);

        row.forEach((cell, i) => {
            const text = String(cell ?? "\u2014");
            const fitted = doc.splitTextToSize(text, colWidths[i] - 6)[0] || "";
            doc.text(fitted, x, y);
            x += colWidths[i];
        });

        y += 15;

    });

    return y + 6;

}


/*
----------------------------------------------------
MAIN REPORT LAYOUT

Order is deliberately management-first: headline
numbers, plain-English summary, recommended actions,
then supporting detail (findings, priority alerts,
notable cases, analyst workload) for anyone who wants
to go one level deeper.
----------------------------------------------------
*/

function renderIntelligencePDF(doc, data) {

    const report = data?.report || {};
    const summary = buildExecutiveSummary(data);
    const recommendations = buildRecommendations(data);
    const riskIndex = computeRiskIndex(data);

    let y = PDF_MARGIN;

    // HEADER
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...PDF_COLORS.text);
    doc.text("Security Intelligence Report", PDF_MARGIN, y);
    y += 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(
        `Report ${report.reportId || "\u2014"}   \u00B7   ${formatReportDate(report.reportDate)}   \u00B7   Generated ${formatDate(data?.generatedAt)}`,
        PDF_MARGIN, y
    );
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...pdfToneColor(riskIndex.tone));
    doc.text(`Overall risk posture: ${riskIndex.band}  (Risk Index ${Math.round(riskIndex.score)}/100)`, PDF_MARGIN, y + 14);
    y += 24;

    doc.setDrawColor(...PDF_COLORS.line);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    y += 24;

    // KEY METRICS
    y = pdfMetricRow(doc, y, [
        { label: "Total alerts", value: pdfNum(summary.total) },
        { label: "High / critical", value: pdfNum(summary.highRisk), tone: summary.highRisk > 0 ? "amber" : "green" },
        { label: "Unassigned high-risk", value: pdfNum(summary.highRiskUnassigned), tone: summary.highRiskUnassigned > 0 ? "red" : "green" },
        { label: "Unassigned total", value: pdfNum(summary.unassigned), tone: summary.unassigned > 0 ? "amber" : "green" }
    ]);

    y += 8;

    // EXECUTIVE SUMMARY
    y = pdfSectionTitle(doc, y, "Executive Summary");
    summary.lines.forEach(line => {
        y = pdfParagraph(doc, y, line);
        y += 4;
    });

    y += 6;

    // RECOMMENDED ACTIONS
    y = pdfSectionTitle(doc, y, "Recommended Actions");
    y = pdfBulletList(doc, y, recommendations);

    y += 6;

    // RISK INDEX
    y = pdfSectionTitle(doc, y, "Risk Index");
    y = pdfGaugeBar(doc, y, riskIndex.band, riskIndex.score, riskIndex.tone);
    y = pdfParagraph(doc, y, "Top drivers of this score:", { fontSize: 9.5, bold: true, color: PDF_COLORS.muted });
    y += 2;
    y = pdfBulletList(doc, y, riskIndex.drivers, { fontSize: 9.5 });

    y += 6;

    // TREND & VELOCITY
    y = pdfSectionTitle(doc, y, "Trend & Velocity");
    y = pdfParagraph(doc, y, buildVelocityInsight(data));

    y += 6;

    // CONCENTRATION & GOVERNANCE
    y = pdfSectionTitle(doc, y, "Concentration & Governance");
    buildConcentrationInsight(data).forEach(line => {
        y = pdfParagraph(doc, y, line);
        y += 4;
    });

    y += 2;

    // TEAM CAPACITY
    y = pdfSectionTitle(doc, y, "Team Capacity");
    y = pdfParagraph(doc, y, buildCapacityInsight(data));

    y += 6;

    // DECISIONS REQUIRING SIGN-OFF
    y = pdfSectionTitle(doc, y, "Decisions Requiring Sign-Off");
    y = pdfBulletList(doc, y, buildDecisionsNeeded(data));

    y += 6;

    // KEY FINDINGS
    const insights = Array.isArray(data?.insights) ? [...data.insights] : [];
    insights.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

    if (insights.length) {

        y = pdfSectionTitle(doc, y, "Key Findings");

        insights.slice(0, 8).forEach(insight => {

            const tone = String(insight.priority || "low").toLowerCase();
            const color = (tone === "critical" || tone === "high") ? PDF_COLORS.accentRed
                : tone === "medium" ? PDF_COLORS.accentAmber
                : PDF_COLORS.accentGreen;

            y = pdfEnsureSpace(doc, y, 16);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(...color);
            doc.text(`[${tone.toUpperCase()}] ${formatInsightType(insight.type)}`, PDF_MARGIN, y);
            y += 13;

            y = pdfParagraph(doc, y, insight.message || "No description available.", { fontSize: 9.5 });

            if (insight.recommendedAction) {
                y = pdfParagraph(doc, y, `Action: ${insight.recommendedAction}`, { fontSize: 9, color: PDF_COLORS.muted });
            }

            y += 8;

        });

    }

    // TOP PRIORITY ALERTS
    const queueAlerts = Array.isArray(data?.prioritization?.alerts) ? [...data.prioritization.alerts] : [];

    if (queueAlerts.length) {

        queueAlerts.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

        y = pdfSectionTitle(doc, y, "Top Priority Alerts");
        y = pdfTable(
            doc, y,
            ["#", "Alert", "Severity", "Status", "Score"],
            queueAlerts.slice(0, 10).map((a, i) => [
                i + 1,
                (a.name || "Untitled alert").slice(0, 42),
                a.severity || "\u2014",
                a.status || "\u2014",
                pdfNum(a.priorityScore ?? 0)
            ]),
            [24, 300, 70, 90, 40]
        );

    }

    // NOTABLE HIGH-RISK CASES
    const importantAlerts = Array.isArray(data?.cyeraDispositionIntelligence?.importantAlerts)
        ? data.cyeraDispositionIntelligence.importantAlerts
        : [];

    if (importantAlerts.length) {

        y = pdfSectionTitle(doc, y, "Notable High-Risk Cases");
        y = pdfTable(
            doc, y,
            ["Alert", "Severity", "Status"],
            importantAlerts.slice(0, 10).map(a => [
                (a.name || "Untitled").slice(0, 55),
                a.severity || "\u2014",
                a.status || "\u2014"
            ]),
            [340, 100, 84]
        );

    }

    // ANALYST WORKLOAD
    const work = data?.cyeraWorkIntelligence;

    if (work) {

        const analystActivity = Array.isArray(work.analystActivity)
            ? [...work.analystActivity].sort((a, b) => (b.handledActions ?? 0) - (a.handledActions ?? 0))
            : [];

        if (analystActivity.length) {

            y = pdfSectionTitle(doc, y, "Analyst Workload");
            y = pdfTable(
                doc, y,
                ["Analyst", "Handled", "Risk Accepted", "False Positive"],
                analystActivity.slice(0, 10).map(a => [
                    a.analyst || "Unknown",
                    pdfNum(a.handledActions ?? 0),
                    pdfNum(a.riskAcceptedActions ?? 0),
                    pdfNum(a.falsePositiveActions ?? 0)
                ]),
                [220, 100, 110, 110]
            );

        }

    }

    // FOOTER on every page
    const pageCount = doc.internal.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...PDF_COLORS.muted);
        doc.text(`Page ${i} of ${pageCount}`, PDF_PAGE_WIDTH - PDF_MARGIN - 60, PDF_PAGE_HEIGHT - 24);
        doc.text("Confidential \u2014 Security Intelligence", PDF_MARGIN, PDF_PAGE_HEIGHT - 24);
    }

}


/*
----------------------------------------------------
EXPORT ENTRY POINT

Wired to the "Export PDF" button. Guards against
exporting before the first successful load, and gives
visible loading/error feedback on the button itself.
----------------------------------------------------
*/

async function generateIntelligencePDF() {

    const button = getElement("pdf-export-button");

    if (!lastIntelligenceData) {
        window.alert("Intelligence data hasn't finished loading yet. Please wait a moment and try again.");
        return;
    }

    const originalLabel = button ? button.textContent : "";

    try {

        if (button) {
            button.disabled = true;
            button.classList.add("is-loading");
            button.textContent = "Preparing PDF\u2026";
        }

        const JsPDFCtor = await loadJsPDF();
        const doc = new JsPDFCtor({ unit: "pt", format: "a4" });

        renderIntelligencePDF(doc, lastIntelligenceData);

        const report = lastIntelligenceData?.report || {};
        const reportId = String(report.reportId || "report").replace(/[^a-z0-9_-]+/gi, "-");
        const reportDate = report.reportDate || new Date().toISOString().slice(0, 10).replace(/-/g, "");

        doc.save(`Security-Intelligence-${reportId}-${reportDate}.pdf`);

    }
    catch (error) {

        console.error("PDF export failed:", error);
        window.alert(`Could not generate the PDF: ${error.message}`);

    }
    finally {

        if (button) {
            button.disabled = false;
            button.classList.remove("is-loading");
            button.textContent = originalLabel || "Export PDF";
        }

    }

}


/*
====================================================
CURRENT-STATE TABS
====================================================
Purely presentational: swaps which existing container
(operational-intelligence / case-outcome / disposition /
risk-acceptance) is visible inside the merged "Current
Security State" panel. No data or render logic changes —
all four still run and populate their containers exactly
as before; only one is shown at a time to cut scrolling.
*/

document.querySelectorAll(".state-tab").forEach(tab => {

    tab.addEventListener("click", () => {

        const target = tab.getAttribute("data-tab");

        document.querySelectorAll(".state-tab").forEach(t => {
            t.classList.toggle("active", t === tab);
        });

        document.querySelectorAll(".state-tab-panel").forEach(panel => {
            panel.classList.toggle(
                "active",
                panel.getAttribute("data-tab-panel") === target
            );
        });

    });

});


/*
====================================================
FINDINGS SHOW ALL / SHOW LESS
====================================================
Purely presentational: toggles a CSS class that removes
the max-height clamp on #insights-container. The findings
themselves are unchanged and already fully rendered by
renderFindings(); this just controls how much is visible
by default.
*/

const findingsToggle = getElement("findings-toggle");
const findingsWrap = getElement("findings-wrap");

if (findingsToggle && findingsWrap) {

    findingsToggle.addEventListener("click", () => {

        const expanded = findingsWrap.classList.toggle("expanded");
        findingsToggle.textContent = expanded ? "Show fewer findings" : "Show all findings";

    });

}


/*
====================================================
REFRESH BUTTON + SHORTCUT
====================================================
*/

const refreshButton = getElement("refresh-button");

if (refreshButton) {
    refreshButton.addEventListener("click", loadIntelligence);
}

// Quiet power-user affordance: "R" refreshes, same as the button.
// Ignored while typing in a form field (none exist on this page today,
// but this keeps the shortcut safe if one is ever added).
document.addEventListener("keydown", (event) => {

    const tag = (event.target?.tagName || "").toLowerCase();
    const isTyping = tag === "input" || tag === "textarea" || event.target?.isContentEditable;

    if (isTyping || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    if (event.key === "r" || event.key === "R") {
        loadIntelligence();
    }

});


/*
====================================================
PDF EXPORT BUTTON
====================================================
Looks for an existing #pdf-export-button in the page
markup first (so you can style/place it by hand in the
HTML). If it isn't there, this injects one immediately
after the refresh button so the feature works out of the
box with no HTML changes required.
====================================================
*/

function ensurePdfExportButton() {

    let button = getElement("pdf-export-button");

    if (button) {
        return button;
    }

    const refresh = getElement("refresh-button");

    if (!refresh || !refresh.parentNode) {
        return null;
    }

    button = document.createElement("button");
    button.id = "pdf-export-button";
    button.type = "button";
    button.className = refresh.className || "btn-refresh";
    button.style.marginLeft = "8px";
    button.textContent = "Export PDF";

    refresh.insertAdjacentElement("afterend", button);

    return button;

}

const pdfExportButton = ensurePdfExportButton();

if (pdfExportButton) {
    pdfExportButton.addEventListener("click", generateIntelligencePDF);
}


/*
====================================================
INITIAL LOAD
====================================================
*/

document.addEventListener("DOMContentLoaded", () => {
    loadIntelligence();
});