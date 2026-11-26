package com.reputationtenability.scanner.ui

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun AppRoot(vm: ScannerViewModel, state: UiState) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.systemBarsPadding().imePadding()) {
            when (state.screen) {
                Screen.Login -> LoginScreen(vm, state)
                Screen.Scan -> ScanScreen(vm, state)
                Screen.Exhibits -> ExhibitsScreen(vm, state)
            }
            if (state.busy) BusyOverlay(state.busyLabel)
            state.error?.let { msg ->
                AlertDialog(
                    onDismissRequest = vm::dismissError,
                    confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } },
                    title = { Text("Something needs attention") },
                    text = { Text(msg) }
                )
            }
        }
    }
}

@Composable
private fun Eyebrow(text: String) =
    Text(text.uppercase(), color = Gold, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)

@Composable
private fun BusyOverlay(label: String) {
    Box(Modifier.fillMaxSize().background(Ink.copy(alpha = 0.75f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Gold)
            Spacer(Modifier.height(16.dp))
            Text(label, color = Muted)
        }
    }
}

@Composable
fun LoginScreen(vm: ScannerViewModel, state: UiState) {
    var identifier by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Eyebrow("Reputation Tenability")
        Spacer(Modifier.height(12.dp))
        Text("Scan statements straight into your file.", fontSize = 30.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp)
        Spacer(Modifier.height(8.dp))
        Text("Sign in with the same username or email and password you use on the website.", color = Muted)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = identifier, onValueChange = { identifier = it }, label = { Text("Username or email") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("Password") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { vm.login(identifier, password) }, enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(12.dp)
        ) { Text("Sign in", fontWeight = FontWeight.Bold) }
        Spacer(Modifier.height(16.dp))
        Text(
            "No account yet? Create one on the website first. Signed in with Google there? Choose a username and password under Account to use this app.",
            color = Muted, fontSize = 12.sp
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(vm: ScannerViewModel, state: UiState) {
    val activity = LocalContext.current as Activity
    val scanner = remember {
        GmsDocumentScanning.getClient(
            GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(true)
                .setPageLimit(30)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build()
        )
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val pages = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages.orEmpty()
            vm.setPages(pages.map { it.imageUri })
        }
    }
    fun startScan() {
        scanner.getStartScanIntent(activity)
            .addOnSuccessListener { sender -> launcher.launch(IntentSenderRequest.Builder(sender).build()) }
            .addOnFailureListener { vm.showError("The scanner couldn't start: ${it.message ?: "please update Google Play services"}.") }
    }
    var menuOpen by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Eyebrow("Billing-error file")
                Text("Hi${state.userName?.let { ", $it" } ?: ""}", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = { vm.go(Screen.Exhibits) }) { Text("My exhibits") }
        }
        Spacer(Modifier.height(16.dp))

        state.receipt?.let { r ->
            Surface(shape = RoundedCornerShape(14.dp), color = Good.copy(alpha = 0.12f), border = BorderStroke(1.dp, Good)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Filed as ${r.exhibitLabel}", color = Good, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Spacer(Modifier.height(4.dp))
                    Text(r.message)
                    if (r.analysisQueued) Text("The statement is being read now; results appear in your portal.", color = Muted, fontSize = 13.sp)
                    TextButton(onClick = vm::dismissReceipt) { Text("Scan another") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        Button(
            onClick = ::startScan, enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(12.dp)
        ) { Text(if (state.pages.isEmpty()) "Scan a statement" else "Rescan", fontWeight = FontWeight.Bold) }

        if (state.pages.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("${state.pages.size} page(s) ready", color = Muted)
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                itemsIndexed(state.pages) { i, uri -> PageThumb(uri, i + 1) }
            }
        }

        Spacer(Modifier.height(22.dp))
        ExposedDropdownMenuBox(expanded = menuOpen, onExpandedChange = { menuOpen = it }) {
            OutlinedTextField(
                value = state.categories.firstOrNull { it.value == state.category }?.label ?: state.category,
                onValueChange = {}, readOnly = true, label = { Text("Exhibit category") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = menuOpen) },
                modifier = Modifier.menuAnchor().fillMaxWidth()
            )
            ExposedDropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                state.categories.forEach { c ->
                    DropdownMenuItem(text = { Text(c.label) }, onClick = { vm.setCategory(c.value); menuOpen = false })
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.cycle, onValueChange = vm::setCycle, label = { Text("Billing cycle (optional)") },
            placeholder = { Text("07/15/25 – 08/05/25") }, singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("First statement on the account", Modifier.weight(1f))
            Switch(checked = state.isFirstStatement, onCheckedChange = vm::setFirstStatement)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = vm::uploadScan, enabled = state.pages.isNotEmpty() && !state.busy,
            modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(12.dp)
        ) { Text("Upload to my portal", fontWeight = FontWeight.Bold) }
        if (state.pages.isNotEmpty()) TextButton(onClick = vm::clearPages) { Text("Discard scan") }

        Spacer(Modifier.height(28.dp))
        Text(
            "Scans are sent only to your private Reputation Tenability workspace and filed as labeled exhibits. Education and record organization, not legal advice.",
            color = Muted, fontSize = 12.sp
        )
        TextButton(onClick = vm::logout) { Text("Sign out") }
    }
}

@Composable
private fun PageThumb(uri: Uri, number: Int) {
    val context = LocalContext.current
    val bitmap by produceState<Bitmap?>(initialValue = null, uri) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri).use {
                    BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = 8 })
                }
            }.getOrNull()
        }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Line), modifier = Modifier.size(width = 84.dp, height = 110.dp)) {
            bitmap?.let { Image(it.asImageBitmap(), contentDescription = "Page $number", contentScale = ContentScale.Crop) }
        }
        Text("$number", color = Muted, fontSize = 12.sp)
    }
}

@Composable
fun ExhibitsScreen(vm: ScannerViewModel, state: UiState) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Eyebrow("Billing-error file")
                Text("My exhibits", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = { vm.go(Screen.Scan) }) { Text("Scan") }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = vm::refreshExhibits) { Text("Refresh") }
        Spacer(Modifier.height(12.dp))
        if (state.exhibits.isEmpty() && !state.busy) {
            Text("No exhibits yet. Scan your first statement.", color = Muted)
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.exhibits, key = { it.id }) { e ->
                Surface(shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, Line), color = Card) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(10.dp), color = Gold.copy(alpha = 0.12f), modifier = Modifier.size(46.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(e.exhibitLabel.removePrefix("Exhibit "), color = Gold, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(e.fileName, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            Text(listOfNotNull(e.folder, e.cycle).joinToString(" · "), color = Muted, fontSize = 12.sp, maxLines = 2)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(e.analysisStatus, color = if (e.analysisStatus == "complete") Good else Muted, fontSize = 12.sp)
                            e.complianceScore?.let { Text("$it/100", fontWeight = FontWeight.Bold) }
                        }
                    }
                }
            }
        }
    }
}
