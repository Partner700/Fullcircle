/* Presentation-only enhancement for the existing Full Circle workspaces.
 * It reads only rendered navigation structure and public role labels. It does
 * not use network requests, storage, account records or application APIs. */
(function () {
  'use strict';
  var queued = false;
  function mark(element, attribute, value) {
    if (!element) return;
    if (value) {
      if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    } else if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
  }
  function refresh() {
    queued = false;
    var root = document.getElementById('root');
    if (!root) return;
    var shell = root.querySelector('.app-safe-header');
    var workspace = shell && shell.parentElement && shell.parentElement.parentElement;
    var role = '';
    if (workspace) {
      var nav = workspace.querySelector('aside nav');
      if (nav && nav.querySelector('[data-guide-nav="sentries"]') && nav.querySelector('[data-guide-nav="tents"]')) role = 'instructor';
      else if (nav && nav.querySelector('[data-guide-nav="overview"]') && nav.querySelector('[data-guide-nav="cadets"]') && nav.querySelector('[data-guide-nav="attendance"]')) role = 'sentry';
      mark(workspace, 'data-fc-leadership', role);
      var dashboardKey = role === 'sentry' ? 'overview' : 'dashboard';
      var active = role && nav.querySelector('[data-guide-nav="' + dashboardKey + '"][aria-current="page"]');
      var main = workspace.querySelector('main');
      var summary = active && main && main.querySelector(role === 'sentry' ? 'main > .space-y-5 > .grid.grid-cols-2.md\\:grid-cols-4.gap-3' : 'main > .space-y-5 > .grid.grid-cols-2.lg\\:grid-cols-4.gap-3');
      // Scope the enhancement to the exact four summary cards, never to game boards.
      if (summary && summary.children.length !== 4) summary = null;
      var previous = workspace.querySelectorAll('[data-fc-leadership-summary]');
      for (var i = 0; i < previous.length; i++) if (previous[i] !== summary) mark(previous[i], 'data-fc-leadership-summary', '');
      mark(summary, 'data-fc-leadership-summary', role);
      mark(main && main.querySelector('[data-guide="profile-details"]'), 'data-fc-leadership-profile', role);
    }
    var campHeader = root.querySelector('main > div > header > h1');
    if (campHeader) mark(campHeader.parentElement, 'data-fc-leadership-camp', campHeader.textContent.trim() === 'Instructor Workspace' ? 'instructor' : '');
    var identities = document.querySelectorAll('.profile-cv-identity');
    for (var j = 0; j < identities.length; j++) {
      var label = identities[j].querySelector('.profile-cv-name + p');
      var labelRole = label ? label.textContent.trim().toLowerCase() : '';
      mark(identities[j], 'data-fc-leadership-profile', labelRole === 'sentry' || labelRole === 'instructor' ? labelRole : '');
    }
  }
  function schedule() {
    if (!queued) { queued = true; window.requestAnimationFrame(refresh); }
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current'] });
  }
  schedule();
}());
