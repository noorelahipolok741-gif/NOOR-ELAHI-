package com.noorelahi.learning;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NoorStoragePlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                try {
                    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView == null) {
                        if (!isFinishing() && !isDestroyed()) finish();
                        return;
                    }
                    webView.evaluateJavascript(
                        "(function(){try{return window.__noorHandleNativeBack ? window.__noorHandleNativeBack() : 'exit';}catch(e){return 'exit';}})()",
                        result -> {
                            if (result != null && result.contains("handled")) {
                                return;
                            }
                            if (!isFinishing() && !isDestroyed()) {
                                finish();
                            }
                        }
                    );
                } catch (Throwable t) {
                    if (!isFinishing() && !isDestroyed()) finish();
                }
            }
        });
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (
            requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN &&
            requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX
        ) {
            try {
                if (getBridge() == null) return;
                PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
                if (pluginHandle == null) {
                    Log.i("Google Activity Result", "SocialLogin login handle is null");
                    return;
                }
                Plugin plugin = pluginHandle.getInstance();
                if (!(plugin instanceof SocialLoginPlugin)) {
                    Log.i("Google Activity Result", "SocialLogin plugin instance is not SocialLoginPlugin");
                    return;
                }
                ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
            } catch (Throwable t) {
                Log.w("Google Activity Result", "Failed handling social login intent", t);
            }
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
