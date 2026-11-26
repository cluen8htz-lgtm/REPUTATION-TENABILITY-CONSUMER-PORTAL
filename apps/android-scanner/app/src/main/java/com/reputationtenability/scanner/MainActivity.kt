package com.reputationtenability.scanner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reputationtenability.scanner.ui.AppRoot
import com.reputationtenability.scanner.ui.RTTheme
import com.reputationtenability.scanner.ui.ScannerViewModel

class MainActivity : ComponentActivity() {
    private val vm: ScannerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RTTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                AppRoot(vm, state)
            }
        }
    }
}
