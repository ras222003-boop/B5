import Foundation
import WebKit

/// Owns web media separately from the ARSession. Stopping a native camera must
/// also cancel speech and streams that were never attached to a video element.
enum BasiraWebMediaLifecycle {
    static let script = #"""
    (() => {
      if (window.__basiraMediaLifecycleInstalled) return;
      Object.defineProperty(window, '__basiraMediaLifecycleInstalled', { value: true });
      let suspended = document.hidden;
      let generation = 0;
      const streams = new Set();
      const recognitions = new Set();
      const stopStream = stream => {
        try { stream?.getTracks().forEach(track => track.stop()); } catch {}
      };
      const suspend = () => {
        suspended = true;
        generation += 1;
        streams.forEach(stopStream);
        streams.clear();
        recognitions.forEach(recognition => { try { recognition.abort(); } catch {} });
        recognitions.clear();
        try { window.speechSynthesis?.cancel(); } catch {}
        document.querySelectorAll('video, audio').forEach(element => {
          try { element.pause(); } catch {}
          stopStream(element.srcObject);
        });
      };
      const resume = () => { if (!document.hidden) suspended = false; };
      const announceResume = () => {
        if (!document.hidden) window.dispatchEvent(new Event('basira:native-resume'));
      };
      const media = navigator.mediaDevices;
      if (media?.getUserMedia) {
        const original = media.getUserMedia.bind(media);
        const capture = async constraints => {
          if (suspended) throw new DOMException('Camera and microphone are stopped.', 'AbortError');
          const attempt = generation;
          const stream = await original(constraints);
          if (suspended || attempt !== generation || document.hidden) {
            stopStream(stream);
            throw new DOMException('Camera and microphone are stopped.', 'AbortError');
          }
          streams.add(stream);
          return stream;
        };
        // Some WebKit variants expose a read-only method. The native capture
        // stop below remains authoritative, and other media cleanup must run.
        try { media.getUserMedia = capture; } catch {}
      }
      for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        const Original = window[name];
        if (!Original) continue;
        const Wrapped = function (...args) {
          const recognition = new Original(...args);
          const start = recognition.start.bind(recognition);
          recognition.start = () => {
            if (suspended) throw new DOMException('Speech input is stopped.', 'AbortError');
            recognitions.add(recognition);
            return start();
          };
          recognition.addEventListener?.('end', () => recognitions.delete(recognition));
          return recognition;
        };
        Wrapped.prototype = Original.prototype;
        Object.setPrototypeOf(Wrapped, Original);
        try { window[name] = Wrapped; } catch {}
      }
      window.addEventListener('basira:native-suspend', suspend);
      window.addEventListener('basira:native-resume', resume);
      window.addEventListener('pagehide', () => {
        window.dispatchEvent(new Event('basira:native-suspend'));
      });
      window.addEventListener('pageshow', announceResume);
      let previousPath = window.location?.pathname;
      const stopNativeAfterRouteExit = () => {
        const leftVision = previousPath === '/navigation/vision' &&
          window.location?.pathname !== '/navigation/vision';
        previousPath = window.location?.pathname;
        const bridge = window.BasiraNativeFrames;
        if (!bridge || !leftVision) return;
        // SPA history changes do not call WKNavigationDelegate. Revoke the
        // current media session before another Basira module becomes active.
        window.dispatchEvent(new Event('basira:native-suspend'));
        const routeGeneration = generation;
        Promise.resolve().then(() => bridge.stop()).then(() => {
          // New user requests in the next module may work; old streams and
          // queued alerts remain stopped. A later background stop wins.
          if (generation === routeGeneration) announceResume();
        }).catch(() => {});
      };
      for (const method of ['pushState', 'replaceState']) {
        const history = window.history;
        if (!history?.[method]) continue;
        const original = history[method].bind(history);
        try {
          history[method] = (...args) => {
            const result = original(...args);
            stopNativeAfterRouteExit();
            return result;
          };
        } catch {}
      }
      window.addEventListener('popstate', stopNativeAfterRouteExit);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          // Notify React too, so its queued alerts cannot resume on stale data.
          window.dispatchEvent(new Event('basira:native-suspend'));
        } else { announceResume(); }
      });
    })();
    """#

    static func install(in content: WKUserContentController) {
        content.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart,
                                          forMainFrameOnly: true))
    }

    static func suspend(_ webView: WKWebView?) {
        guard let webView else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('basira:native-suspend'));",
                                   completionHandler: nil)
        webView.setAllMediaPlaybackSuspended(true, completionHandler: nil)
        webView.setCameraCaptureState(.none, completionHandler: nil)
        webView.setMicrophoneCaptureState(.none, completionHandler: nil)
    }

    /// Foregrounding enables a subsequent user request; it never restarts media.
    static func resume(_ webView: WKWebView?) {
        guard let webView else { return }
        webView.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        webView.evaluateJavaScript("window.dispatchEvent(new Event('basira:native-resume'));",
                                   completionHandler: nil)
    }

    static func mayRequestCapture(scheme: String, host: String, port: Int,
                                  mainFrame: Bool, page: URL?, allowedOrigin: URL,
                                  active: Bool, visible: Bool) -> Bool {
        guard active, visible, mainFrame,
              scheme.lowercased() == "https",
              host.lowercased() == allowedOrigin.host?.lowercased(),
              [0, 443].contains(port), let page else { return false }
        return BasiraWebOrigin.allows(page, within: allowedOrigin)
    }
}
