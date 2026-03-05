package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: healthcheck <url>")
		os.Exit(1)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(os.Args[1])
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		os.Exit(1)
	}
}
