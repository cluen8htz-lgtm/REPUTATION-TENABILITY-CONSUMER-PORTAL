package com.reputationtenability.scanner

import android.app.Application
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader

class ScannerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        PDFBoxResourceLoader.init(applicationContext)
    }
}
