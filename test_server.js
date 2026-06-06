fetch("http://localhost:6801/health").then(res => console.log(res.status)).catch(err => console.log("Failed 6801"));
fetch("http://localhost:6802/health").then(res => console.log(res.status)).catch(err => console.log("Failed 6802"));
