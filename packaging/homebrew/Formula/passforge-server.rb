class PassforgeServer < Formula
  desc "Stateless algorithm server for PassForge (passforge-remote-v1)"
  homepage "https://github.com/benforcapita/PassForge"
  # url/sha256 are filled in by release.yml when the homebrew-passforge tap is updated.
  url "https://github.com/benforcapita/PassForge/archive/refs/tags/v12.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "GPL-3.0-only"

  depends_on "rust" => :build

  def install
    system "cargo", "install", *std_cargo_args(path: "crates/passforge-server")
  end

  service do
    run opt_bin/"passforge-server"
    environment_variables PASSFORGE_BIND: "127.0.0.1:8787"
    keep_alive true
    log_path var/"log/passforge-server.log"
    error_log_path var/"log/passforge-server.log"
  end

  test do
    port = free_port
    ENV["PASSFORGE_BIND"] = "127.0.0.1:#{port}"
    pid = fork { exec bin/"passforge-server" }
    sleep 2
    info = JSON.parse(shell_output("curl -s http://127.0.0.1:#{port}/v1/info"))
    assert_equal "passforge-remote-v1", info["protocol"]
  ensure
    Process.kill("TERM", pid)
    Process.wait(pid)
  end
end
