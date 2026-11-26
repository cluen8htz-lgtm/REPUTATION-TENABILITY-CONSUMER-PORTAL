package com.reputationtenability.scanner.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Stores the portal sign-in token encrypted with a hardware-backed key. */
class Session(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "rt_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
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
