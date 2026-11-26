package com.reputationtenability.scanner.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/** Stores the portal sign-in token encrypted with a hardware-backed key. */
class Session(context: Context) {
    // security-crypto 1.0.0 (stable) API: an AES-256-GCM key in the Android Keystore.
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        "rt_session",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().apply { if (value == null) remove("token") else putString("token", value) }.apply()

    var displayName: String?
        get() = prefs.getString("name", null)
        set(value) = prefs.edit().putString("name", value).apply()

    fun clear() = prefs.edit().clear().apply()
}
