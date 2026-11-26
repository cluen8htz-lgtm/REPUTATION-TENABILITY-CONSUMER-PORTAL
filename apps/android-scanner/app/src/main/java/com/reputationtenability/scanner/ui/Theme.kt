package com.reputationtenability.scanner.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Gold = Color(0xFFF0B44C)
val Ink = Color(0xFF09090B)
val Card = Color(0xFF121215)
val Line = Color(0xFF26262C)
val Muted = Color(0xFFA1A1AA)
val Good = Color(0xFF22C55E)
val Bad = Color(0xFFF87171)

private val Scheme = darkColorScheme(
    primary = Gold,
    onPrimary = Color(0xFF111111),
    background = Ink,
    onBackground = Color(0xFFF4F4F5),
    surface = Card,
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Card,
    onSurfaceVariant = Muted,
    outline = Line,
    error = Bad
)

@Composable
fun RTTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = Scheme, content = content)
