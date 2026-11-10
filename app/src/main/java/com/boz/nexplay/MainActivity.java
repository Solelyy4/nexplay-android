package com.boz.nexplay;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * NEXPLAY — app streaming (WebView wrapper).
 *
 * Memuat app dari assets/index.html supaya boleh guna luar talian untuk shell.
 * Data katalog diambil dari Internet Archive / AniList / TVMaze.
 * D-pad Android TV: WebView uruskan fokus sendiri; kita hanya pastikan
 * navigasi kekal dalam app (bukan keluar ke pelayar).
 */
public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle simpan) {
        super.onCreate(simpan);

        // Skrin sentiasa hidup semasa main video
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // autoplay untuk TV
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Semua pautan kekal dalam app
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                v.loadUrl(r.getUrl().toString());
                return true;
            }
        });

        // Skrin penuh untuk video
        web.setWebChromeClient(new WebChromeClient() {
            private View skrinPenuh;

            @Override
            public void onShowCustomView(View v, CustomViewCallback cb) {
                skrinPenuh = v;
                setContentView(v);
                sembunyiSistem();
            }

            @Override
            public void onHideCustomView() {
                if (skrinPenuh != null) {
                    setContentView(web);
                    skrinPenuh = null;
                    sembunyiSistem();
                }
            }
        });

        setContentView(web);
        sembunyiSistem();
        web.loadUrl("file:///android_asset/index.html");
    }

    private void sembunyiSistem() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean f) {
        super.onWindowFocusChanged(f);
        if (f) sembunyiSistem();
    }

    // Butang kembali: kembali dalam app, bukan keluar terus
    @Override
    public boolean onKeyDown(int kod, KeyEvent e) {
        if (kod == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(kod, e);
    }

    @Override
    protected void onPause() { super.onPause(); if (web != null) web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
