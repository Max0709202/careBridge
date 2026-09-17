// The public account-deletion page's behaviour.
//
// A separate file rather than an inline <script> because this origin is served
// under `script-src 'self'` with no 'unsafe-inline' — see
// infrastructure/nginx/security-headers.conf. Plain DOM and `fetch`, no
// framework: the whole point of this page is that it works without the app's
// bundle, for somebody who has already uninstalled it.
//
// Same-origin, so `/api` is the nginx proxy in front of the API and
// `connect-src 'self'` covers it.
(function () {
  'use strict';

  var API = '/api/v1';

  var requestStep = document.getElementById('request-step');
  var confirmStep = document.getElementById('confirm-step');
  var result = document.getElementById('result');
  var resultBox = document.getElementById('result-box');
  var resultText = document.getElementById('result-text');
  var resultActions = document.getElementById('result-actions');
  var downloadButton = document.getElementById('download');

  var exported = null;

  function show(section) {
    [requestStep, confirmStep, result].forEach(function (element) {
      element.hidden = element !== section;
    });
  }

  function say(message, bad) {
    resultText.textContent = message;
    resultBox.className = bad ? 'box bad' : 'box';
    show(result);
  }

  /**
   * Reads the API's error envelope.
   *
   * The server's message is shown verbatim when there is one, because for the
   * cases that actually reach here — a journey under way, an unpaid invoice,
   * an expired link — it is a sentence written for this person with the remedy
   * in it, and anything this page substituted would be vaguer.
   */
  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (payload) {
          if (response.ok) return payload;
          var message =
            (payload && payload.error && payload.error.message) ||
            (payload && payload.message) ||
            'Something went wrong. Please try again.';
          throw new Error(message);
        });
    });
  }

  function busy(button, on, labelWhenBusy) {
    button.disabled = on;
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = labelWhenBusy;
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  // ─── step one: ask for the link ───────────────────────────────────────────

  var form = document.getElementById('request-form');
  var submit = document.getElementById('request-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = document.getElementById('email').value.trim();
    if (email === '' || email.indexOf('@') === -1) {
      say('That does not look like an email address.', true);
      show(requestStep);
      return;
    }

    busy(submit, true, 'Sending…');
    post('/auth/account/deletion-request', { email: email })
      .then(function () {
        // Deliberately the same answer whether or not the address has an
        // account. Whether it does is a fact about a person who, for this
        // product, has a vulnerable relative — and this page is public.
        say(
          'If that address has a CareBridge account, a confirmation link is on its way. ' +
            'Open it to schedule the deletion. The link works once and expires.',
          false,
        );
      })
      .catch(function (error) {
        say(error.message, true);
      })
      .finally(function () {
        busy(submit, false);
      });
  });

  // ─── step two: the link was opened ────────────────────────────────────────

  var confirm = document.getElementById('confirm-submit');

  confirm.addEventListener('click', function () {
    var token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      say('That link is no longer valid. Request a new one.', true);
      return;
    }

    busy(confirm, true, 'Deleting…');
    post('/auth/account/deletion-request/confirm', { token: token })
      .then(function (receipt) {
        exported = receipt && receipt.data ? receipt.data : null;

        var when = receipt && receipt.scheduledFor
          ? new Date(receipt.scheduledFor).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : null;

        say(
          'Your account is scheduled for deletion' +
            (when ? ' on ' + when : '') +
            '. Every device has been signed out. If you change your mind, sign in again before then — that cancels it.',
          false,
        );

        // Offered here because the request has already signed every device
        // out, so this is the last moment this person can be handed their own
        // data without signing back in — which would itself cancel the
        // deletion.
        if (exported) resultActions.hidden = false;
      })
      .catch(function (error) {
        say(error.message, true);
      })
      .finally(function () {
        busy(confirm, false);
      });
  });

  downloadButton.addEventListener('click', function () {
    if (!exported) return;
    var blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: 'application/json',
    });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'carebridge-account-data.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoked on the next turn of the event loop rather than immediately —
    // Safari has not started reading the blob by the time click() returns.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  });

  // ─── which step ───────────────────────────────────────────────────────────

  show(
    new URLSearchParams(window.location.search).get('token')
      ? confirmStep
      : requestStep,
  );
})();
