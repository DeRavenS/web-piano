import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:permission_handler/permission_handler.dart';

// The web app (repo root) is bundled under assets/web and served from a
// localhost server inside the app: browsers only allow the microphone on
// secure origins, and http://localhost counts as one.
const _port = 8642;
final _server = InAppLocalhostServer(documentRoot: 'assets/web', port: _port);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await _server.start();
  runApp(const WebPianoApp());
}

class WebPianoApp extends StatelessWidget {
  const WebPianoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Web Piano',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
      home: const PianoPage(),
    );
  }
}

class PianoPage extends StatefulWidget {
  const PianoPage({super.key});

  @override
  State<PianoPage> createState() => _PianoPageState();
}

class _PianoPageState extends State<PianoPage> with WidgetsBindingObserver {
  InAppWebViewController? _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Pausing the WebView fires the page's visibilitychange, which releases the
  // microphone and silences audio while the app is in the background.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _controller?.pause();
    } else if (state == AppLifecycleState.resumed) {
      _controller?.resume();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1B1D23),
      body: SafeArea(
        child: InAppWebView(
          initialUrlRequest: URLRequest(url: WebUri('http://localhost:$_port/index.html')),
          initialSettings: InAppWebViewSettings(
            mediaPlaybackRequiresUserGesture: false,
            allowsInlineMediaPlayback: true,
            supportZoom: false,
            builtInZoomControls: false,
            transparentBackground: true,
          ),
          onWebViewCreated: (controller) => _controller = controller,
          // getUserMedia in the page -> Android runtime microphone permission.
          onPermissionRequest: (controller, request) async {
            final wantsMic = request.resources.contains(PermissionResourceType.MICROPHONE);
            final granted = wantsMic && (await Permission.microphone.request()).isGranted;
            return PermissionResponse(
              resources: request.resources,
              action: granted ? PermissionResponseAction.GRANT : PermissionResponseAction.DENY,
            );
          },
        ),
      ),
    );
  }
}
