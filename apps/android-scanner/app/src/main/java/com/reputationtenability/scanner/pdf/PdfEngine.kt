package com.reputationtenability.scanner.pdf

import android.graphics.Bitmap
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import java.io.File

/**
 * PdfBox-Android wrapper. Call every method from a background thread
 * (withContext(Dispatchers.IO)). PDFBoxResourceLoader.init() runs in ScannerApp.
 */
class PdfEngine {

    enum class PageSize(val rectangle: PDRectangle) {
        A4(PDRectangle.A4), LETTER(PDRectangle.LETTER), LEGAL(PDRectangle.LEGAL)
    }

    private val lowMemory: MemoryUsageSetting get() = MemoryUsageSetting.setupTempFileOnly()

    private fun load(file: File, password: String = ""): PDDocument =
        PDDocument.load(file, password, lowMemory)

    private fun requireDistinct(input: File, output: File) =
        require(input.canonicalPath != output.canonicalPath) { "Output must be a different file than input" }

    /** Scanned pages → PDF. Each image is fit inside the page (aspect ratio kept, centered). */
    fun createPdfFromBitmaps(
        bitmaps: List<Bitmap>,
        output: File,
        pageSize: PageSize = PageSize.LETTER,
        quality: Int = 85,
        margin: Float = 18f
    ) {
        require(bitmaps.isNotEmpty()) { "No pages to save" }
        PDDocument(lowMemory).use { doc ->
            for (bmp in bitmaps) {
                val page = PDPage(pageSize.rectangle)
                doc.addPage(page)
                val image = JPEGFactory.createFromImage(doc, bmp, quality / 100f)
                val box = page.mediaBox
                val scale = minOf((box.width - 2 * margin) / bmp.width, (box.height - 2 * margin) / bmp.height)
                val w = bmp.width * scale
                val h = bmp.height * scale
                PDPageContentStream(doc, page).use { cs ->
                    cs.drawImage(image, (box.width - w) / 2, (box.height - h) / 2, w, h)
                }
            }
            doc.save(output)
        }
    }

    /** Merge several PDFs in order (copies fonts/images properly). */
    fun mergePdfs(inputs: List<File>, output: File) {
        require(inputs.isNotEmpty()) { "No files to merge" }
        inputs.forEach { requireDistinct(it, output) }
        PDFMergerUtility().apply {
            inputs.forEach { addSource(it) }
            destinationFileName = output.absolutePath
        }.mergeDocuments(lowMemory)
    }

    /** Extract pages fromPage..toPage (0-based, inclusive). */
    fun splitPdf(input: File, output: File, fromPage: Int, toPage: Int) {
        requireDistinct(input, output)
        load(input).use { src ->
            require(fromPage in 0..toPage && toPage < src.numberOfPages) {
                "Invalid page range $fromPage..$toPage (document has ${src.numberOfPages} pages)"
            }
            PDDocument(lowMemory).use { out ->
                for (i in fromPage..toPage) out.importPage(src.getPage(i))
                out.save(output)
            }
        }
    }

    /** AES-256 lock. The owner password must differ from the open password. */
    fun encryptPdf(input: File, output: File, userPassword: String, ownerPassword: String) {
        requireDistinct(input, output)
        require(ownerPassword.isNotEmpty() && ownerPassword != userPassword) {
            "Owner password must be set and differ from the open password"
        }
        val permissions = AccessPermission().apply {
            setCanPrint(true)
            setCanModify(false)
            setCanExtractContent(true)
        }
        val policy = StandardProtectionPolicy(ownerPassword, userPassword, permissions).apply {
            encryptionKeyLength = 256
        }
        load(input).use { doc ->
            doc.protect(policy)
            doc.save(output)
        }
    }

    /** Unlock: save an unprotected copy. Throws InvalidPasswordException on a wrong password. */
    fun decryptPdf(input: File, output: File, password: String) {
        requireDistinct(input, output)
        load(input, password).use { doc ->
            doc.isAllSecurityToBeRemoved = true
            doc.save(output)
        }
    }

    /** Stamp a signature IMAGE (not a cryptographic signature). PNG keeps transparency. */
    fun addSignatureImage(
        input: File, output: File, signature: Bitmap,
        pageIndex: Int, x: Float, y: Float, width: Float
    ) {
        requireDistinct(input, output)
        load(input).use { doc ->
            require(pageIndex in 0 until doc.numberOfPages) { "Page $pageIndex does not exist" }
            val page = doc.getPage(pageIndex)
            val img = LosslessFactory.createFromImage(doc, signature)
            val height = width * signature.height / signature.width
            PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                cs.drawImage(img, x, y, width, height)
            }
            doc.save(output)
        }
    }

    fun getPageCount(file: File, password: String = ""): Int = load(file, password).use { it.numberOfPages }

    fun isEncrypted(file: File): Boolean = try {
        load(file).use { it.isEncrypted }
    } catch (e: InvalidPasswordException) {
        true
    }
}
