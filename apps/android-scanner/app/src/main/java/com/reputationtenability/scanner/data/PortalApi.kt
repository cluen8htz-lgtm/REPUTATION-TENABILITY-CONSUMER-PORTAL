package com.reputationtenability.scanner.data

import com.reputationtenability.scanner.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

data class Category(val value: String, val label: String)
data class Exhibit(
    val id: Int,
    val exhibitLabel: String,
    val fileName: String,
    val folder: String,
    val cycle: String?,
    val analysisStatus: String,
    val complianceScore: Int?
)
data class FiledExhibit(val exhibitLabel: String, val folder: String, val message: String, val analysisQueued: Boolean)

class ApiException(message: String, val unauthorized: Boolean = false) : Exception(message)

/** Talks to the Reputation Tenability portal's /api/mobile endpoints. */
class PortalApi(private val baseUrl: String = BuildConfig.PORTAL_URL.trimEnd('/')) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private suspend fun call(request: Request): JSONObject = withContext(Dispatchers.IO) {
        try {
            http.newCall(request).execute().use { res ->
                val body = res.body?.string().orEmpty()
                val json = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                if (!res.isSuccessful) {
                    throw ApiException(json.optString("error").ifBlank { "Server error (${res.code})." }, res.code == 401)
                }
                json
            }
        } catch (e: IOException) {
            throw ApiException("No connection to the portal. Check your internet and try again.")
        }
    }

    private fun authed(path: String, token: String) =
        Request.Builder().url("$baseUrl$path").header("Authorization", "Bearer $token")

    suspend fun login(identifier: String, password: String): Pair<String, String> {
        val body = JSONObject().put("identifier", identifier).put("password", password).toString()
            .toRequestBody("application/json".toMediaType())
        val json = call(Request.Builder().url("$baseUrl/api/mobile/login").post(body).build())
        val user = json.getJSONObject("user")
        val name = user.optString("name").ifBlank { user.optString("username") }
        return json.getString("token") to name
    }

    suspend fun categories(): List<Category> {
        val json = call(Request.Builder().url("$baseUrl/api/mobile/categories").build())
        val arr = json.getJSONArray("categories")
        return List(arr.length()) { i -> arr.getJSONObject(i).let { Category(it.getString("value"), it.getString("label")) } }
    }

    suspend fun exhibits(token: String): List<Exhibit> {
        val json = call(authed("/api/mobile/fcba/exhibits", token).build())
        val arr = json.getJSONArray("exhibits")
        return List(arr.length()) { i ->
            arr.getJSONObject(i).let {
                Exhibit(
                    id = it.getInt("id"),
                    exhibitLabel = it.getString("exhibitLabel"),
                    fileName = it.getString("fileName"),
                    folder = it.getString("folder"),
                    cycle = it.optString("cycle").takeIf { c -> c.isNotBlank() && c != "null" },
                    analysisStatus = it.optString("analysisStatus"),
                    complianceScore = if (it.isNull("complianceScore")) null else it.optInt("complianceScore")
                )
            }
        }
    }

    suspend fun uploadExhibit(
        token: String, pdf: File, fileName: String, category: String, cycle: String, isFirstStatement: Boolean
    ): FiledExhibit {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, pdf.asRequestBody("application/pdf".toMediaType()))
            .addFormDataPart("category", category)
            .addFormDataPart("cycle", cycle)
            .addFormDataPart("isFirstStatement", isFirstStatement.toString())
            .build()
        val json = call(authed("/api/mobile/fcba/exhibits", token).post(body).build())
        return FiledExhibit(
            exhibitLabel = json.getString("exhibitLabel"),
            folder = json.getString("folder"),
            message = json.getString("message"),
            analysisQueued = json.optBoolean("analysisQueued")
        )
    }
}
