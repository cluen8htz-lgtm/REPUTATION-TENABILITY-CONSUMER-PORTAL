package com.reputationtenability.scanner.ui

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.reputationtenability.scanner.data.ApiException
import com.reputationtenability.scanner.data.Category
import com.reputationtenability.scanner.data.Exhibit
import com.reputationtenability.scanner.data.FiledExhibit
import com.reputationtenability.scanner.data.PortalApi
import com.reputationtenability.scanner.data.Session
import com.reputationtenability.scanner.pdf.PdfEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class Screen { Login, Scan, Exhibits }

data class UiState(
    val screen: Screen = Screen.Login,
    val userName: String? = null,
    val busy: Boolean = false,
    val busyLabel: String = "",
    val error: String? = null,
    val categories: List<Category> = DEFAULT_CATEGORIES,
    val category: String = "statements",
    val cycle: String = "",
    val isFirstStatement: Boolean = false,
    val pages: List<Uri> = emptyList(),
    val receipt: FiledExhibit? = null,
    val exhibits: List<Exhibit> = emptyList()
)

val DEFAULT_CATEGORIES = listOf(
    Category("statements", "Periodic Statements"),
    Category("credit_reports", "Credit Reports & Balances"),
    Category("disputes", "Disputes & Correspondence"),
    Category("agreement", "Cardmember Agreement / Credit Documents"),
    Category("tracking", "Proof of Mailing / Tracking"),
    Category("scores", "Score Reports & Damages"),
    Category("responses", "Creditor Responses")
)

class ScannerViewModel(app: Application) : AndroidViewModel(app) {
    private val api = PortalApi()
    private val session = Session(app)
    private val pdf = PdfEngine()

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        if (session.token != null) {
            _state.update { it.copy(screen = Screen.Scan, userName = session.displayName) }
        }
        viewModelScope.launch {
            runCatching { api.categories() }.onSuccess { list -> if (list.isNotEmpty()) _state.update { it.copy(categories = list) } }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }
    fun dismissReceipt() = _state.update { it.copy(receipt = null) }
    fun setCategory(value: String) = _state.update { it.copy(category = value) }
    fun setCycle(value: String) = _state.update { it.copy(cycle = value.take(40)) }
    fun setFirstStatement(value: Boolean) = _state.update { it.copy(isFirstStatement = value) }
    fun setPages(uris: List<Uri>) = _state.update { it.copy(pages = uris, receipt = null) }
    fun clearPages() = _state.update { it.copy(pages = emptyList()) }
    fun showError(message: String) = _state.update { it.copy(error = message) }

    fun go(screen: Screen) {
        _state.update { it.copy(screen = screen, error = null) }
        if (screen == Screen.Exhibits) refreshExhibits()
    }

    fun login(identifier: String, password: String) {
        if (identifier.isBlank() || password.isBlank()) return showError("Enter your username or email and password.")
        launchBusy("Signing in…") {
            val (token, name) = api.login(identifier.trim(), password)
            session.token = token
            session.displayName = name
            _state.update { it.copy(screen = Screen.Scan, userName = name) }
        }
    }

    fun logout() {
        session.clear()
        _state.value = UiState(categories = _state.value.categories)
    }

    fun refreshExhibits() {
        val token = session.token ?: return logout()
        launchBusy("Loading exhibits…") {
            val list = api.exhibits(token)
            _state.update { it.copy(exhibits = list) }
        }
    }

    /** Build one PDF from the scanned pages with PdfEngine, then file it as the next exhibit. */
    fun uploadScan() {
        val s = _state.value
        val token = session.token ?: return logout()
        if (s.pages.isEmpty()) return showError("Scan at least one page first.")
        launchBusy("Building PDF…") {
            val stamp = SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.US).format(Date())
            val fileName = "RT-Scan-$stamp.pdf"
            val out = File(getApplication<Application>().cacheDir, fileName)
            withContext(Dispatchers.IO) {
                val bitmaps = s.pages.map { decodeScaled(it) }
                try {
                    pdf.createPdfFromBitmaps(bitmaps, out, PdfEngine.PageSize.LETTER, quality = 85)
                } finally {
                    bitmaps.forEach { it.recycle() }
                }
            }
            _state.update { it.copy(busyLabel = "Uploading to your portal…") }
            try {
                val filed = api.uploadExhibit(token, out, fileName, s.category, s.cycle, s.isFirstStatement)
                _state.update { it.copy(receipt = filed, pages = emptyList(), cycle = "", isFirstStatement = false) }
            } finally {
                out.delete()
            }
        }
    }

    /** Decode a scanned page, downscaling large photos to keep memory in check (~2000px long edge). */
    private fun decodeScaled(uri: Uri): Bitmap {
        val resolver = getApplication<Application>().contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2000) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw ApiException("Could not read a scanned page. Please scan again.")
    }

    private fun launchBusy(label: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, busyLabel = label, error = null) }
            try {
                block()
            } catch (e: ApiException) {
                if (e.unauthorized) {
                    logout()
                    _state.update { it.copy(error = "Your session expired. Please sign in again.") }
                } else {
                    _state.update { it.copy(error = e.message) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Something went wrong. Please try again.") }
            } finally {
                _state.update { it.copy(busy = false, busyLabel = "") }
            }
        }
    }
}
